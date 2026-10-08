"""PostgreSQL adapter for PoliticData's existing SQLite-style query interface."""
import re
import psycopg
from psycopg.rows import dict_row

def convert_sql(sql):
    sql=re.sub(r"CAST\(julianday\('now'\)-julianday\(MAX\(m\.meeting_date\)\) AS INTEGER\)",
               "CAST(CURRENT_DATE - NULLIF(MAX(m.meeting_date),'')::date AS INTEGER)",sql)
    sql=sql.replace("date('now','-30 days')","to_char(CURRENT_DATE - INTERVAL '30 days','YYYY-MM-DD')")
    sql=sql.replace("date('now')","to_char(CURRENT_DATE,'YYYY-MM-DD')")
    return sql.replace('?', '%s')

class PgResult:
    def __init__(self, cursor):
        self.cursor=cursor
        self.rowcount=cursor.rowcount
        self.lastrowid=None
        if cursor.description and cursor.description[0].name=='id':
            row=cursor.fetchone()
            if row:self.lastrowid=row['id']
    def fetchone(self):return self.cursor.fetchone()
    def fetchall(self):return self.cursor.fetchall()

class PgConnection:
    def __init__(self,url):
        self.conn=psycopg.connect(url,sslmode='require',row_factory=dict_row,connect_timeout=8)
    def __enter__(self):return self
    def __exit__(self,typ,val,tb):
        try:
            if typ:self.conn.rollback()
            else:self.conn.commit()
        finally:self.conn.close()
    def execute(self,sql,args=()):
        statement=convert_sql(sql)
        if statement.lstrip().upper().startswith('INSERT INTO') and 'RETURNING' not in statement.upper():
            statement += ' RETURNING id'
        cursor=self.conn.execute(statement,args)
        return PgResult(cursor)
    def executescript(self,script):
        self.conn.execute(script)
