"""
MediScan — Database Integration
================================
MySQL connection to DrugLookup table.
Caches drug names in memory for fast RapidFuzz matching.
"""

import os
import logging
from typing import List, Optional, Dict

logger = logging.getLogger(__name__)

# Cache
_drug_names_cache: Optional[List[str]] = None
_drug_details_cache: Optional[Dict[str, dict]] = None
_brand_to_generic_cache: Optional[Dict[str, str]] = None

# DB config from environment
DB_HOST = os.getenv('DB_HOST', 'localhost')
DB_PORT = int(os.getenv('DB_PORT', '3306'))
DB_NAME = os.getenv('DB_NAME', 'medscan')
DB_USER = os.getenv('DB_USER', 'root')
DB_PASSWORD = os.getenv('DB_PASSWORD', 'password')


def _get_connection():
    """Get MySQL connection."""
    import mysql.connector
    return mysql.connector.connect(
        host=DB_HOST,
        port=DB_PORT,
        database=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
    )


def load_drug_names() -> List[str]:
    """
    Load all drug names from DrugLookup table into memory.
    Called once at startup for fast fuzzy matching.
    """
    global _drug_names_cache, _drug_details_cache, _brand_to_generic_cache

    if _drug_names_cache is not None:
        return _drug_names_cache

    try:
        conn = _get_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT id, name, manufacturer, price, composition1, 
                   description, side_effects, drug_interactions
            FROM drug_lookups 
            WHERE name IS NOT NULL AND name != ''
        """)
        rows = cursor.fetchall()
        cursor.close()
        conn.close()

        _drug_names_cache = []
        _drug_details_cache = {}
        _brand_to_generic_cache = {}

        for row in rows:
            name = row['name'].strip()
            if name:
                _drug_names_cache.append(name)
                _drug_details_cache[name.lower()] = {
                    'id': row['id'],
                    'name': name,
                    'manufacturer': row.get('manufacturer', ''),
                    'price': row.get('price'),
                    'composition': row.get('composition1', ''),
                    'description': row.get('description', ''),
                    'side_effects': row.get('side_effects', ''),
                    'drug_interactions': row.get('drug_interactions', ''),
                }

                # Build brand → generic mapping from composition
                composition = row.get('composition1', '')
                if composition:
                    _brand_to_generic_cache[name] = composition

        # Deduplicate
        _drug_names_cache = list(set(_drug_names_cache))

        logger.info(f"Loaded {len(_drug_names_cache):,} drug names into cache")
        return _drug_names_cache

    except Exception as e:
        logger.error(f"Failed to load drug names from DB: {e}")
        logger.info("Falling back to empty drug cache — fuzzy matching will be unavailable")
        _drug_names_cache = []
        _drug_details_cache = {}
        _brand_to_generic_cache = {}
        return _drug_names_cache


def get_drug_details(name: str) -> Optional[dict]:
    """Get full details for a drug by name."""
    if _drug_details_cache is None:
        load_drug_names()

    return _drug_details_cache.get(name.lower())


def get_brand_to_generic() -> Dict[str, str]:
    """Get brand → generic (composition) mapping."""
    if _brand_to_generic_cache is None:
        load_drug_names()
    return _brand_to_generic_cache or {}


def search_drugs(query: str, limit: int = 10) -> List[dict]:
    """Search drugs by name (SQL LIKE query)."""
    try:
        conn = _get_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute(
            "SELECT id, name, manufacturer, price, composition1 "
            "FROM drug_lookups WHERE name LIKE %s LIMIT %s",
            (f'%{query}%', limit)
        )
        results = cursor.fetchall()
        cursor.close()
        conn.close()
        return results
    except Exception as e:
        logger.error(f"Drug search failed: {e}")
        return []
