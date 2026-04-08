#!/usr/bin/env python3
"""Quick test of the new vector memory service."""

import os
os.environ['CHATBOT_MEMORY_SERVICE_HOST'] = '127.0.0.1'
os.environ['CHATBOT_MEMORY_SERVICE_PORT'] = '8765'
os.environ['CHATBOT_MEMORY_DB_FILE'] = 'data/chatbot-memory.sqlite3'

# Start the service
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
from chatbot_memory_service_vector import main

if __name__ == '__main__':
    main()
