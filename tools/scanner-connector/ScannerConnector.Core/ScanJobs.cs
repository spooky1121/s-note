namespace Snote.ScannerConnector.Core;

public sealed record ScanStatus(Guid Id, string State, string? Code = null);
public sealed class ScanJobs(IScannerAdapter adapter, PairingState pairing, TimeProvider clock) : IDisposable
{
    private sealed class Job(ScanRequest request, LocalCapability owner)
    {
        public ScanRequest Request { get; } = request;
        public LocalCapability Owner { get; } = owner;
        public string State = "running";
        public string? Code;
        public ScanImage? Image;
        public DateTimeOffset? Finished;
        public bool Cancelled;
        public CancellationTokenSource AcquisitionCancellation { get; } = new();
    }
    private readonly object gate = new();
    private readonly Dictionary<Guid, Job> jobs = new();
    private readonly CancellationTokenSource stopping = new();
    private Job? running;
    private bool disposed;
    private void Prune()
    {
        foreach (var item in jobs.ToArray())
        {
            var job = item.Value;
            if (!pairing.IsCurrent(job.Owner))
            {
                job.Cancelled = true; job.AcquisitionCancellation.Cancel(); job.Image = null;
                if (!ReferenceEquals(running, job)) { jobs.Remove(item.Key); job.AcquisitionCancellation.Dispose(); }
            }
            else if (job.Finished is { } finished && clock.GetUtcNow() >= finished.AddMinutes(5))
            {
                job.Image = null;
                if (job.State == "complete") job.State = "expired";
            }
        }
    }
    private Job Owned(Guid id, LocalCapability owner)
    {
        Prune();
        if (!jobs.TryGetValue(id, out var job) || job.Owner.Key != owner.Key || job.Owner.Origin != owner.Origin)
            throw new ConnectorException("NOT_FOUND", 404);
        if (job.State == "expired") throw new ConnectorException("EXPIRED", 410);
        return job;
    }
    private static ScanStatus Status(Job job) => new(job.Request.Id, job.State, job.Code);
    public ScanStatus Start(ScanRequest request, LocalCapability owner)
    {
        lock (gate)
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            Prune();
            if (jobs.TryGetValue(request.Id, out var existing))
            {
                if (existing.Owner.Key != owner.Key) throw new ConnectorException("NOT_FOUND", 404);
                if (existing.Request != request) throw new ConnectorException("INVALID_REQUEST", 409);
                if (existing.State == "expired") throw new ConnectorException("EXPIRED", 410);
                return Status(existing);
            }
            if (running is not null) throw new ConnectorException("BUSY", 409);
            // Spent UUIDs outlive their image. At capacity, revoke this session
            // instead of evicting IDs and risking a delayed physical re-scan.
            if (jobs.Count(p => p.Value.Owner.Key == owner.Key) >= 128)
            {
                pairing.Revoke(owner); Prune();
                throw new ConnectorException("PAIRING_REQUIRED", 401);
            }
            var job = new Job(request, owner);
            jobs.Add(request.Id, job); running = job;
            _ = Run(job);
            return Status(job);
        }
    }
    private async Task Run(Job job)
    {
        try
        {
            var devices = await adapter.GetDevicesAsync(stopping.Token);
            var device = devices.FirstOrDefault(d => d.Id == job.Request.DeviceId);
            if (device is null || !device.Sources.Contains(job.Request.Source)) throw new ConnectorException("NO_DEVICE");
            Task<ScanImage> acquisition;
            lock (gate)
            {
                if (job.Cancelled || disposed || !pairing.IsCurrent(job.Owner)) throw new ConnectorException("CANCELLED");
                // Calling the adapter while holding the gate orders cancellation
                // against acquisition enqueueing. The STA adapter checks this
                // token before starting, never ending an active transfer early.
                acquisition = adapter.ScanAsync(job.Request, job.AcquisitionCancellation.Token);
            }
            var image = await acquisition;
            if (image.MimeType != "image/jpeg" || image.Data.Length is < 1 or > 5242880 ||
                image.Width < 1 || image.Height < 1 || (long)image.Width * image.Height > 40_000_000 ||
                image.Data.Length < 4 || image.Data[0] != 0xff || image.Data[1] != 0xd8 ||
                image.Data[^2] != 0xff || image.Data[^1] != 0xd9) throw new ConnectorException("SCAN_FAILED");
            lock (gate)
            {
                if (!job.Cancelled && !disposed && pairing.IsCurrent(job.Owner))
                {
                    // Retain only the most recent image, not a file archive.
                    foreach (var old in jobs.Values.Where(x => x.Image is not null)) { old.Image = null; old.State = "expired"; }
                    job.Image = image; job.State = "complete";
                }
                else { job.State = "cancelled"; job.Image = null; }
            }
        }
        catch (Exception error)
        {
            lock (gate)
            {
                job.Image = null; job.State = job.Cancelled || disposed ? "cancelled" : "failed";
                job.Code = error is ConnectorException known && known.Code is "NO_DEVICE" or "DRIVER_ERROR" or "NO_PAPER" or "CANCELLED" or "BUSY" ? known.Code : "SCAN_FAILED";
            }
        }
        finally
        {
            lock (gate)
            {
                job.Finished = clock.GetUtcNow();
                if (ReferenceEquals(running, job)) running = null;
                Prune();
            }
        }
    }
    public ScanStatus Get(Guid id, LocalCapability owner) { lock (gate) return Status(Owned(id, owner)); }
    public void Sweep() { lock (gate) { if (!disposed) Prune(); } }
    public ScanImage Image(Guid id, LocalCapability owner)
    {
        lock (gate)
        {
            var job = Owned(id, owner);
            return job.State == "complete" && job.Image is not null ? job.Image : throw new ConnectorException(job.State == "cancelled" ? "CANCELLED" : "BUSY", 409);
        }
    }
    public ScanStatus Cancel(Guid id, LocalCapability owner)
    {
        lock (gate)
        {
            var job = Owned(id, owner); job.Cancelled = true; job.AcquisitionCancellation.Cancel(); job.Image = null; job.State = "cancelled"; job.Code = null;
            // A blocking native transfer is allowed to finish, but its result
            // is discarded. The device remains busy until that task exits.
            return Status(job);
        }
    }
    public void Dispose()
    {
        lock (gate)
        {
            if (disposed) return;
            disposed = true; stopping.Cancel();
            foreach (var job in jobs.Values) { job.Cancelled = true; job.AcquisitionCancellation.Cancel(); job.Image = null; }
            jobs.Clear();
        }
    }
}
