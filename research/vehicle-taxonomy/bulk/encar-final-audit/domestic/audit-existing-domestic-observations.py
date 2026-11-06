#!/usr/bin/env python3
"""Recheck each archived domestic CLS label against fresh public factual rows.

Parent paths were reviewed separately from browser tables. This script verifies
literal leaves, source binding and row order, while preserving a duplicated
physical source row instead of inventing another retail trim.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re


def compact(value):return re.sub(r'\s+','',value).casefold()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--observed',type=Path,default=Path(__file__).with_name('existing-13-observed-CLS.json'))
    parser.add_argument('--output',type=Path,default=Path(__file__).with_name('existing-206-classification-audit.json'))
    args=parser.parse_args();observed=json.loads(args.observed.read_text());data=json.loads(args.source.read_text());results=[];models=[]
    for source in data['sources']:
        if not source.get('sourceModelRaw'):continue
        document_id=source['id'].rsplit('-',1)[-1];frame=observed['frames'][document_id]
        rows=[(int(re.match(r'L(\d+):',value)[1]),value)for value in frame['facts']if not value.startswith('L0:')]
        cursor=-1;matched=[]
        for index,record in enumerate(data['records']):
            if record['sourceId']!=source['id']:continue
            leaf=record['sourceHierarchyRaw'][-1]
            candidates=[(number,value)for number,value in rows if number>cursor and any(compact(cell).startswith(compact(leaf)) for cell in re.sub(r'^L\d+: ','',value).split('|'))]
            assert candidates,(record['model'],record['sourceHierarchyRaw'],cursor)
            number,value=candidates[0];cursor=number;matched.append(number)
            results.append({'sourceRecordOrdinal':index+1,'sourceId':source['id'],'model':record['model'],'sourceHierarchyRaw':record['sourceHierarchyRaw'],'sourceLine':number,'sourceLineRaw':value,'leafLiteralAndSourceOrderingVerified':True,'parentPathManuallyReviewed':True,'modelIdentityParentPageReviewed':True,'currentRetailCodesOrYearCompletenessVerified':False})
        unused=[(number,value)for number,value in rows if number not in matched]
        models.append({'model':source['sourceModelRaw'],'sourceId':source['id'],'documentId':document_id,'sourceURL':frame['url'],'observations':len(matched),'physicalSourceRows':len(rows),'unconsumedSourceRows':[{'line':number,'raw':value}for number,value in unused]})
    assert len(results)==206
    assert sum(len(row['unconsumedSourceRows'])for row in models)==1
    duplicate=next(row for row in models if row['unconsumedSourceRows'])
    assert duplicate['model']=='로체' and duplicate['unconsumedSourceRows'][0]['line'] in {27,29}
    result={'schemaVersion':1,'auditedOn':'2026-11-07','inputSha256':hashlib.sha256(args.source.read_bytes()).hexdigest(),'scope':'Existing 13 domestic history models and 206 distinct factual CLS observations only; no claim of complete domestic Encar hierarchy.','parentModelsChecked':13,'observationsChecked':len(results),'physicalSourceRows':sum(row['physicalSourceRows']for row in models),'missingUniqueClassificationPathsFound':0,'duplicatePhysicalSourceRows':1,'perModel':models,'records':results,'limitations':['Timeline cell years are not model years.','Engine comparison tables also contain earlier/later models.','The repeated Lotze LEX24 black premium Mojin-highest source cell is not a missing distinct trim.']}
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({key:value for key,value in result.items() if key not in ['records','perModel']},ensure_ascii=False))


if __name__=='__main__':main()
