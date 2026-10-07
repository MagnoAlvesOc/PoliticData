import os,tempfile,unittest
from pathlib import Path
with tempfile.TemporaryDirectory() as d:
    os.environ['POLITICDATA_DB']=str(Path(d)/'test.db')
    os.environ['POLITICDATA_PASSWORD']='test-password-unique'
    import app
    class Tests(unittest.TestCase):
        @classmethod
        def setUpClass(cls):app.init()
        def test_schema(self):
            with app.connect() as db:
                tables={r['name'] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            self.assertTrue({'users','leaders','meetings','demands','expenses','elections'}.issubset(tables))
        def test_password(self):
            with app.connect() as db:u=db.execute('SELECT * FROM users').fetchone()
            self.assertTrue(app.check_password('test-password-unique',u['salt'],u['password_hash']))
            self.assertFalse(app.check_password('incorrect',u['salt'],u['password_hash']))
        def test_constraints(self):
            import sqlite3
            with self.assertRaises(sqlite3.IntegrityError):
                with app.connect() as db:db.execute('INSERT INTO expenses(expense_date,category,description,amount) VALUES(?,?,?,?)',('2026-10-07','Teste','Inválido',-5))
    unittest.main(verbosity=2)
