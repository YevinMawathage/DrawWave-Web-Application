import sqlite3
import pickle

class Persistence:
    def __init__(self, db_name="drawings.db"):
        try:
            self.connection = sqlite3.connect(db_name)
            self.cursor = self.connection.cursor()
            self.cursor.execute('''CREATE TABLE IF NOT EXISTS drawings (id INTEGER PRIMARY KEY, data BLOB)''')
        except sqlite3.Error as e:
            print(f"[ERROR] Database connection failed: {e}")
    
    def save_drawing(self, data):
        data_blob = pickle.dumps(data)  
        self.cursor.execute("INSERT INTO drawings (data) VALUES (?)", (data_blob,))
        self.connection.commit()

    def get_drawings(self):
        self.cursor.execute("SELECT * FROM drawings")
        return self.cursor.fetchall()
