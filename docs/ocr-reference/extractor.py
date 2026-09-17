"""Regex field extraction from OCR text only; no medicine dictionary or answer key.

Labels and common form/frequency syntax are supported. Misspellings are preserved
so the scorer can distinguish exact and partial matches rather than correcting them.
"""
import re

FORMS = r'tablet|capsule|syrup|ointment|drops|injection'
DOSE = r'(?P<dosage_amount>\d+(?:\.\d+)?)\s*(?P<dosage_unit>mg|ml|g|IU|drops)\b'


def extract_fields(text):
    def grab(pattern):
        match = re.search(pattern, text, re.I | re.M)
        return match.group(1).strip(' .-|') if match else None
    fields = {
        'doctor_name': grab(r'\bDr\.?\s+(.+?)(?=\s*[-|,]\s*(?:MBBS|MD|MS)|\s+(?:MBBS|MD|MS)\b|$)'),
        'degree': grab(r'\b((?:MBBS|MD|MS)(?:\s+(?:MD|MS))?)\b'),
        'clinic_name': grab(r'^\s*(.*(?:Clinic|Centre))\s*$'),
        'contact_number': grab(r'(?:Phone|Contact|Tel)\s*[:.]?\s*(\+?\d[\d \-]{8,18}\d)'),
        'address': grab(r'Address\s*[:.]?\s*(.+)$'),
        'patient_name': grab(r'Patient\s*[:.]?\s*(.+)$'),
        'patient_age': grab(r'Age\s*[:.]?\s*(\d{1,3})\b'),
        'patient_gender': grab(r'(?:Gender|Sex)\s*[:.]?\s*(Male|Female)\b'),
        'medicines': [],
    }
    # A medicine block begins at its form/name/dose line; the next line may carry frequency.
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for i, line in enumerate(lines):
        form = re.search(r'\b(' + FORMS + r')\b', line, re.I)
        dose = re.search(DOSE, line, re.I)
        if not form or not dose:
            continue
        prefix = re.sub(r'^\s*\d+\s*[.)\-:]?\s*', '', line[:dose.start()])
        name = re.sub(r'\b(' + FORMS + r')\b', '', prefix, count=1, flags=re.I).strip(' .-|')
        if not name:
            continue
        block = line[dose.end():]
        if i+1 < len(lines) and not re.search(DOSE, lines[i+1], re.I):
            block += ' ' + lines[i+1]
        frequency = re.search(r'\b(OD|BD|TDS|QID|[01]\s*-\s*[01]\s*-\s*[01])\b', block, re.I)
        duration = re.search(r'\b(\d+\s+days?)\b', block, re.I)
        fields['medicines'].append(dict(name=name, form=form.group(1), **dose.groupdict(),
                                       frequency=frequency.group(1) if frequency else None,
                                       duration=duration.group(1) if duration else None))
    return fields


extract = extract_fields
