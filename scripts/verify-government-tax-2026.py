#!/usr/bin/env python3
"""Independent acceptance checks for the saved government research index and price rules."""
import argparse, csv, gzip, hashlib, importlib.util, json, sqlite3, tempfile
from pathlib import Path


def load_builder(path):
 spec=importlib.util.spec_from_file_location('government_builder',path)
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


def run(builder_path,database,expected_rows,expected_modifications):
 b=load_builder(builder_path);checks={};price_cases=[]
 for raw,typ,unit,exact,integer in [('17810','n','천원','17810000',17810000),('\u00a02,590','s','천원','2590000',2590000),('17810','n','원','17810',17810),('0','n','원','0',0)]:
  r=b.parse_price(raw,typ,unit,'acceptance_test_explicit_unit');assert r['sourcePriceRaw']==raw and r['wonExact']==exact and r['wonInteger']==integer and not r['requiresReview'];price_cases.append(r)
 for raw,exact,candidate in [('3499.9999999999995','3499999.9999999995','3500000'),('3899.9999999999995','3899999.9999999995','3900000')]:
  r=b.parse_price(raw,'n','천원','acceptance_test_explicit_unit');assert r['wonExact']==exact and r['wonInteger'] is None and r['wonRoundingCandidate']==candidate and r['requiresReview'];price_cases.append(r)
 for raw in [None,'','-','－']:
  r=b.parse_price(raw,'s','천원','acceptance_test_explicit_unit');assert r['wonExact'] is None and r['wonInteger'] is None and r['requiresReview'];price_cases.append(r)
 for unit in ['만원','unknown',None]:
  try:b.parse_price('5','n',unit,'acceptance_test_explicit_unit')
  except ValueError:pass
  else:raise AssertionError('Unsupported/unknown unit was accepted')
 assert b.resolve_unit({'sourceSheet':'unit priority','amountUnitRaw':'원'},{'amountUnitRaw':'천원'},{'originalAmountUnit':'천원'})==('원','record.amountUnitRaw')
 try:b.resolve_unit({'sourceSheet':'no explicit unit'},{},{})
 except ValueError:pass
 else:raise AssertionError('Missing unit did not fail closed')
 typed=json.loads(b.typed_fields_json({'number':'120','text':'120','empty':None},{'number':'n','text':'s','empty':None}));assert isinstance(typed['number'],int)and isinstance(typed['text'],str)and typed['empty']is None
 checks['priceUnitAndExactArithmeticCases']=price_cases;checks['strictUnknownUnitRejection']=True;checks['numericVsTextJsonTypesPreserved']=True
 before=b.sha256_file(database);con=sqlite3.connect('file:'+str(database.resolve())+'?mode=ro',uri=True);con.row_factory=sqlite3.Row
 assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok';assert not con.execute('PRAGMA foreign_key_check').fetchall()
 assert con.execute('SELECT count(*)FROM vehicle_records').fetchone()[0]==expected_rows
 assert con.execute('SELECT count(*)FROM modification_records').fetchone()[0]==expected_modifications
 metadata={r[0]:json.loads(r[1])for r in con.execute('SELECT key,value_json FROM metadata')};assert metadata['sourceYearIsModelYear']is False and metadata['applicationCalculationUse']is False and metadata['pricesAreRetailSellingPrices']is False
 float_rows=[dict(r)for r in con.execute("SELECT sourcePriceThousandsRaw,wonExact,wonInteger,wonRoundingCandidate,requiresReview FROM vehicle_records WHERE amountParseStatus='source_float_artifact_requires_review' ORDER BY record_no")];assert len(float_rows)==2
 assert {r['wonExact']for r in float_rows}=={'3499999.9999999995','3899999.9999999995'}
 assert all(r['wonInteger']is None and r['requiresReview']==1 for r in float_rows)
 assert con.execute("SELECT count(*)FROM modification_records WHERE amountParseStatus='undetermined_marker' AND wonExact IS NULL AND wonInteger IS NULL").fetchone()[0]==33
 assert con.execute("SELECT count(*)FROM vehicle_records WHERE json_type(fields_typed_json,'$.차명') IN ('integer','real')").fetchone()[0]==3
 assert con.execute("SELECT count(*)FROM vehicle_records WHERE json_type(fields_typed_json,'$.형식') IN ('integer','real')").fetchone()[0]==metadata['expectedSourceCounts']['numericSourceTypeCodes']
 assert con.execute("SELECT declared_vehicle_category_raw FROM vehicle_records r JOIN sheets s USING(sheet_id) WHERE s.sheet_name='외산 4-1.이륜(형식)' AND r.source_row=1118").fetchone()[0]is None
 blank=con.execute("SELECT fields_raw_json FROM vehicle_records r JOIN sheets s USING(sheet_id) WHERE s.sheet_name='국산 2-3.승합(친환경)_기종' ORDER BY r.source_row LIMIT 1").fetchone()[0];assert '__column_D'in json.loads(blank)and json.loads(blank)['__column_D']is None
 duplicate_prices={r[0]for r in con.execute("SELECT sourcePriceThousandsRaw FROM vehicle_records WHERE manufacturer_raw='케이지모빌리티' AND type_raw='A9DL22A4-01H' AND vehicle_name_raw='코란도투리스모'")};assert duplicate_prices=={'27340','27560'}
 assert con.execute('SELECT count(*)FROM type_name_conflict_members m LEFT JOIN vehicle_records r ON r.record_no=m.vehicle_record_no WHERE r.record_no IS NULL').fetchone()[0]==0
 assert con.execute("SELECT count(*)FROM vehicle_records WHERE fuel_raw IS NOT NULL AND json_extract(fields_raw_json,'$.연료원')IS NULL").fetchone()[0]==0
 for query in ['기아 카니발','BMW','EL450A','하이브리드','CTNT-E70LG-0L']:
  assert b.search(con,query,3),query
 # Search is literal: punctuation/quotes/wildcards are data, not SQL syntax.
 assert b.search(con,"' OR 1=1 --",3)==[]
 for table,csvname in [('vehicle_records','vehicle-records.organized.csv.gz'),('modification_records','modification-records.organized.csv.gz')]:
  with gzip.open(database.parent/csvname,'rt',encoding='utf-8',newline='')as f:csvrows=sum(1 for _ in csv.reader(f))-1
  assert csvrows==con.execute('SELECT count(*)FROM '+table).fetchone()[0]
 con.close();assert b.sha256_file(database)==before
 checks.update({'sqliteIntegrity':'ok','foreignKeyViolations':0,'vehicleRows':expected_rows,'modificationRows':expected_modifications,'floatSourceRows':float_rows,'undeterminedPricesNullNotZero':33,'numericNamesPreserved':3,'numericTypeCodesPreserved':metadata['expectedSourceCounts']['numericSourceTypeCodes'],'blankHeaderDPositionPreserved':True,'missingOriginalCategoryNotFilled':True,'sameNameTypeDifferentPricesRetained':True,'fuelNotInferred':True,'literalSearchAndFtsExamplesPassed':True,'organizedCsvRowCountsMatch':True,'readOnlyVerificationChangedDatabase':False,'passed':True})
 return checks


def main():
 p=argparse.ArgumentParser();p.add_argument('--database',type=Path,required=True);p.add_argument('--builder',type=Path,default=Path(__file__).with_name('build-government-tax-2026.py'));p.add_argument('--expected-vehicle-rows',type=int,required=True);p.add_argument('--expected-modifications',type=int,default=431);p.add_argument('--output',type=Path,required=True);a=p.parse_args();result=run(a.builder,a.database,a.expected_vehicle_rows,a.expected_modifications);a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items()if k not in ['priceUnitAndExactArithmeticCases','floatSourceRows']},ensure_ascii=False,indent=2))
if __name__=='__main__':main()
