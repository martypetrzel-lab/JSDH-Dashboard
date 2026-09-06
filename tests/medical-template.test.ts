import test from 'node:test';
import assert from 'node:assert/strict';
import { MEDICAL_TEMPLATE_MAX_SIZE, validateMedicalTemplateFile } from '../lib/medical-template.ts';

void test('povolí neprázdný lékařský posudek DOC',()=>{
  assert.equal(validateMedicalTemplateFile({name:'lekarsky-posudek.doc',size:41984}),null);
});

void test('povolí DOCX a PDF bez ohledu na velikost písmen přípony',()=>{
  assert.equal(validateMedicalTemplateFile({name:'vzor.DOCX',size:100}),null);
  assert.equal(validateMedicalTemplateFile({name:'vzor.PDF',size:100}),null);
});

void test('odmítne prázdný, příliš velký a nepovolený soubor',()=>{
  assert.match(validateMedicalTemplateFile({name:'vzor.pdf',size:0})??'',/prázdný/);
  assert.match(validateMedicalTemplateFile({name:'vzor.pdf',size:MEDICAL_TEMPLATE_MAX_SIZE+1})??'',/10 MB/);
  assert.match(validateMedicalTemplateFile({name:'vzor.exe',size:100})??'',/DOC/);
});
