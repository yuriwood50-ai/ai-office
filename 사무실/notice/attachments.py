"""공식 첨부의 텍스트만 표준입력/표준출력으로 넘겨요. 파일을 저장하거나 실행하지 않아요."""
import sys, io, zipfile, json
import xml.etree.ElementTree as ET

def extract(data, hint):
    if data.startswith(b'%PDF'):
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        parts = []
        for page in reader.pages:
            parts.append(page.extract_text() or '')
            if sum(map(len, parts)) > 200000:
                raise ValueError('첨부 본문이 읽기 상한을 넘었어요. 전체 확인이 필요해요.')
        return '\n'.join(parts)
    if data.startswith(b'PK'):
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            names = [n for n in z.namelist() if n.startswith('Contents/section') and n.endswith('.xml') or n == 'word/document.xml']
            if not names:
                raise ValueError('HWPX/DOCX 본문을 찾지 못했어요.')
            infos = [z.getinfo(n) for n in names]
            if sum(i.file_size for i in infos) > 8000000:
                raise ValueError('압축 해제 크기가 읽기 상한을 넘었어요.')
            text = '\n'.join(' '.join(ET.fromstring(z.read(n)).itertext()) for n in sorted(names))
            if len(text) > 200000:
                raise ValueError('첨부 본문이 읽기 상한을 넘었어요.')
            return text
    raise ValueError('이 첨부 형식(HWP·스캔 등)은 자동 해석을 지원하지 않아요. 직접 확인이 필요해요.')

try:
    data = sys.stdin.buffer.read(4 * 1024 * 1024 + 1)
    if len(data) > 4 * 1024 * 1024:
        raise ValueError('첨부가 읽기 크기 상한을 넘었어요.')
    text = extract(data, sys.argv[1] if len(sys.argv) > 1 else '')
    if len(text.strip()) < 10:
        raise ValueError('읽을 수 있는 글자가 없어요. 스캔 첨부는 직접 확인이 필요해요.')
    print(json.dumps({'text': text}, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({'error': str(exc)}, ensure_ascii=False))
    sys.exit(1)
