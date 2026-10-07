"""Converte o arquivo oficial TSE 2024 MA de votação por seção em CSV PoliticData.
Fonte: https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_secao/votacao_secao_2024_MA.zip
Somente dados públicos; não contém eleitores identificáveis.
Uso: python import_tse_2024_ma.py [arquivo.zip] [saida.csv]
"""
import csv, io, sys, zipfile, urllib.request, unicodedata
from pathlib import Path
URL='https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_secao/votacao_secao_2024_MA.zip'
HEADERS=['election_year','round','office','municipality','neighborhood','zone','section','polling_place','candidate','votes','source','latitude','longitude']

def normalize(s):
    return ''.join(c for c in unicodedata.normalize('NFKD',str(s or '').upper()) if not unicodedata.combining(c)).strip()
def get(row,*keys):
    for key in keys:
        if key in row and row[key] is not None: return str(row[key]).strip()
    return ''
def main():
    source=Path(sys.argv[1]) if len(sys.argv)>1 else Path('votacao_secao_2024_MA.zip')
    target=Path(sys.argv[2]) if len(sys.argv)>2 else Path('politicdata_sao_luis_2024.csv')
    if not source.exists():
        print('Baixando arquivo público do TSE (pode ser grande)...')
        urllib.request.urlretrieve(URL,source)
    count=0
    with zipfile.ZipFile(source) as z, target.open('w',encoding='utf-8',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=HEADERS);writer.writeheader()
        for filename in z.namelist():
            if not filename.lower().endswith('.csv'): continue
            with z.open(filename) as raw:
                reader=csv.DictReader(io.TextIOWrapper(raw,encoding='latin-1',newline=''),delimiter=';')
                for row in reader:
                    municipality=get(row,'NM_MUNICIPIO')
                    if normalize(municipality)!='SAO LUIS': continue
                    office=get(row,'DS_CARGO')
                    if normalize(office)!='VEREADOR': continue
                    zone=get(row,'NR_ZONA'); section=get(row,'NR_SECAO')
                    candidate=get(row,'NM_VOTAVEL','NR_VOTAVEL')
                    votes=get(row,'QT_VOTOS')
                    if not zone or not section or not candidate or not votes: continue
                    writer.writerow(dict(election_year=2024,round=get(row,'NR_TURNO') or '1',
                        office='Vereador',municipality='São Luís',neighborhood='',
                        zone=zone,section=section,polling_place='',
                        candidate=candidate,votes=votes,
                        source=URL,latitude='',longitude=''))
                    count+=1
    print('Linhas de São Luís exportadas:',count)
    print('Arquivo:',target)
    if count==0:
        print('AVISO: nenhum registro encontrado. Confira o leiaute oficial.')
if __name__=='__main__': main()
