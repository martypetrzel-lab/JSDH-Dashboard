export const MEDICAL_TEMPLATE_MAX_SIZE = 10 * 1024 * 1024;
export const MEDICAL_TEMPLATE_EXTENSIONS = ['.doc', '.docx', '.pdf'] as const;

export function validateMedicalTemplateFile(file: { name: string; size: number }) {
  const name = file.name.trim();
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
  if (!name || name.length > 255) return 'Název souboru je neplatný.';
  if (!MEDICAL_TEMPLATE_EXTENSIONS.includes(extension as (typeof MEDICAL_TEMPLATE_EXTENSIONS)[number])) return 'Povolené formáty jsou DOC, DOCX a PDF.';
  if (file.size <= 0) return 'Soubor je prázdný.';
  if (file.size > MEDICAL_TEMPLATE_MAX_SIZE) return 'Soubor může mít nejvýše 10 MB.';
  return null;
}
