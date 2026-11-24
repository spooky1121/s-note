/* Korean named public holidays, verified 2024–2027. No runtime lunar estimates or requests.
 * Published annual almanacs (MSIT/KASA, hosted by KASI or the official policy portal):
 * https://www.kasi.re.kr/kor/publication/post/newsMaterial/29633 (2024)
 * https://www.kasi.re.kr/kor/publication/post/newsMaterial/30071 (2025)
 * https://www.kasi.re.kr/publication/post/newsMaterial/32031 (2026)
 * https://www.korea.kr/briefing/pressReleaseView.do?newsId=156768474 (2027),
 * cross-checked against KASI calendarData?search_year=YYYY;
 * https://www.law.go.kr/LSW/lsInfoP.do?lsId=002404 ; MPM press releases
 * cntId=4250 (2026 Labour/Constitution holidays), 3940 (2024-10-01), 4008 (2025-01-27),
 * and https://www.korea.kr/news/policyNewsView.do?newsId=148941443 (2025-06-03).
 * The annual records include announced election/temporary holidays as checked 2026-11-24.
 * 2026 Labour Day applies from May 1; Constitution Day returns from July 17
 * after the May 11 effective date. Neither is retroactively a public holiday in 2024/2025.
 * Ordinary Sundays remain the calendar UI's responsibility; regional/company holidays are excluded.
 * Unsupported years deliberately have no estimated records. They do not restrict scheduling.
 */
(()=>{'use strict';
 const scope=typeof window==='object'?window:globalThis;
 if(scope.SnoteKoreanHolidays)return;
 const annual={
  2024:[
   ['01-01','1월 1일'],
   ['02-09','설날 전날'],['02-10','설날'],['02-11','설날 다음 날'],['02-12','대체공휴일(설날)'],
   ['03-01','삼일절'],['04-10','제22대 국회의원선거'],
   ['05-05','어린이날'],['05-06','대체공휴일(어린이날)'],['05-15','부처님오신날'],
   ['06-06','현충일'],['08-15','광복절'],
   ['09-16','추석 전날'],['09-17','추석'],['09-18','추석 다음 날'],
   ['10-01','임시공휴일(국군의 날)'],['10-03','개천절'],['10-09','한글날'],['12-25','기독탄신일']
  ],
  2025:[
   ['01-01','1월 1일'],['01-27','임시공휴일'],['01-28','설날 전날'],['01-29','설날'],['01-30','설날 다음 날'],
   ['03-01','삼일절'],['03-03','대체공휴일(삼일절)'],
   ['05-05','어린이날'],['05-05','부처님오신날'],['05-06','대체공휴일(부처님오신날)'],
   ['06-03','제21대 대통령선거'],['06-06','현충일'],['08-15','광복절'],
   ['10-03','개천절'],['10-05','추석 전날'],['10-06','추석'],['10-07','추석 다음 날'],
   ['10-08','대체공휴일(추석)'],['10-09','한글날'],['12-25','기독탄신일']
  ],
  2026:[
   ['01-01','1월 1일'],['02-16','설날 전날'],['02-17','설날'],['02-18','설날 다음 날'],
   ['03-01','삼일절'],['03-02','대체공휴일(삼일절)'],
   ['05-01','노동절'],['05-05','어린이날'],['05-24','부처님오신날'],['05-25','대체공휴일(부처님오신날)'],
   ['06-03','제9회 전국동시지방선거'],['06-06','현충일'],['07-17','제헌절'],
   ['08-15','광복절'],['08-17','대체공휴일(광복절)'],
   ['09-24','추석 전날'],['09-25','추석'],['09-26','추석 다음 날'],
   ['10-03','개천절'],['10-05','대체공휴일(개천절)'],['10-09','한글날'],['12-25','기독탄신일']
  ],
  2027:[
   ['01-01','1월 1일'],['02-06','설날 전날'],['02-07','설날'],['02-08','설날 다음 날'],['02-09','대체공휴일(설날)'],
   ['03-01','삼일절'],['05-01','노동절'],['05-03','대체공휴일(노동절)'],['05-05','어린이날'],['05-13','부처님오신날'],
   ['06-06','현충일'],['07-17','제헌절'],['07-19','대체공휴일(제헌절)'],
   ['08-15','광복절'],['08-16','대체공휴일(광복절)'],
   ['09-14','추석 전날'],['09-15','추석'],['09-16','추석 다음 날'],
   ['10-03','개천절'],['10-04','대체공휴일(개천절)'],['10-09','한글날'],['10-11','대체공휴일(한글날)'],
   ['12-25','기독탄신일'],['12-27','대체공휴일(기독탄신일)']
  ]
 };
 const years=Object.freeze(Object.keys(annual).map(Number)),cache=new Map();
 const hasYear=year=>Number.isInteger(year)&&Object.hasOwn(annual,year);
 function yearData(year){
  if(!hasYear(year))return null;
  if(!cache.has(year)){
   const entries=new Map();
   for(const [day,name]of annual[year]){const key=year+'-'+day,prior=entries.get(key);entries.set(key,prior?prior+' · '+name:name);}
   cache.set(year,entries);
  }
  return cache.get(year);
 }
 function getYear(year){return new Map(yearData(year)||[]);}
 function getMonth(year,month){
  const entries=yearData(year);
  if(!entries||!Number.isInteger(month)||month<1||month>12)return new Map();
  const prefix=year+'-'+String(month).padStart(2,'0')+'-';
  return new Map([...entries].filter(([date])=>date.startsWith(prefix)));
 }
 function getDate(date){
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))return '';
  return yearData(Number(date.slice(0,4)))?.get(date)||'';
 }
 const coverage=Object.freeze({from:years[0],to:years.at(-1),firstYear:years[0],lastYear:years.at(-1),years,verifiedAt:'2026-11-24',basis:'published-annual-dates',ordinarySundays:false});
 scope.SnoteKoreanHolidays=Object.freeze({version:'2026-11-24',getMonth,getDate,getYear,hasYear,coverage});
})();
