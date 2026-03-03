"""
MySQL Database Connection
"""

import mysql.connector
from mysql.connector import pooling

# ── Update these to match your MySQL config ──
DB_CONFIG = {
    "host":     "localhost",       # or your DB host/IP
    "port":     3306,
    "user":     "your_db_user",
    "password": "your_db_password",
    "database": "your_db_name",    # DB that contains the medicines table
}

# Connection pool — handles concurrent API requests efficiently
_pool = None


def get_db_connection():
    """Returns a MySQL connection from the pool."""
    global _pool
    if _pool is None:
        _pool = pooling.MySQLConnectionPool(
            pool_name="medicine_pool",
            pool_size=5,
            **DB_CONFIG
        )
    return _pool.get_connection()
