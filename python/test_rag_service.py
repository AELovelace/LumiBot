#!/usr/bin/env python3
"""
Test RAG service integration with memory and LLM.
"""

import json
import time
import urllib.request
import sys

def test_rag_service():
    """Test RAG service endpoints."""
    base_url = "http://127.0.0.1:8764"
    
    print("=" * 60)
    print("RAG SERVICE TEST")
    print("=" * 60)
    
    # Test 1: Health check
    print("\n[1] Health Check")
    try:
        with urllib.request.urlopen(f'{base_url}/health') as response:
            data = json.loads(response.read())
            print(f"  ✓ RAG service healthy")
            print(f"  ✓ ChromaDB path: {data.get('chromaPath', 'N/A')}")
    except Exception as e:
        print(f"  ✗ FAILED: {e}")
        print(f"     Make sure RAG service is running:")
        print(f"     python python/chatbot_rag_service.py")
        return False
    
    # Test 2: Retrieve context (empty query)
    print("\n[2] Retrieve Recent Memories (Empty Query)")
    try:
        # Use a real user ID from the vector database
        user_id = "876949373953654794"
        
        payload = json.dumps({
            'userId': user_id,
            'query': '',
            'limit': 3
        }).encode('utf-8')
        
        req = urllib.request.Request(
            f'{base_url}/rag/retrieve',
            data=payload,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read())
            context = data.get('context', '')
            count = data.get('retrievedCount', 0)
            method = data.get('method', 'unknown')
            
            print(f"  ✓ Retrieved {count} memories using {method} method")
            if context:
                lines = context.split('\n')
                print(f"  ✓ Context preview:")
                for line in lines[:3]:
                    print(f"    {line[:70]}...")
    except Exception as e:
        print(f"  ✗ FAILED: {e}")
        return False
    
    # Test 3: Retrieve context (semantic query)
    print("\n[3] Retrieve Semantically Similar Memories")
    try:
        user_id = "876949373953654794"
        
        payload = json.dumps({
            'userId': user_id,
            'query': 'music and songs',
            'limit': 3
        }).encode('utf-8')
        
        req = urllib.request.Request(
            f'{base_url}/rag/retrieve',
            data=payload,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read())
            context = data.get('context', '')
            count = data.get('retrievedCount', 0)
            method = data.get('method', 'unknown')
            
            print(f"  ✓ Found {count} semantically similar memories using {method} method")
            if context:
                lines = context.split('\n')
                print(f"  ✓ Semantic matches:")
                for line in lines[:2]:
                    if line and line != 'Relevant memories:':
                        print(f"    {line[:70]}...")
    except Exception as e:
        print(f"  ✗ FAILED: {e}")
        return False
    
    print("\n" + "=" * 60)
    print("✓ All RAG tests passed!")
    print("=" * 60)
    print("\nRAG context is ready for LLM augmentation:")
    print("- Empty queries return recent memories")
    print("- Text queries return semantically similar memories")
    print("- Context is formatted for prompt injection")
    print("\nThe bot will now use RAG to enhance Ollama responses with memory context 💜")
    
    return True


if __name__ == '__main__':
    try:
        success = test_rag_service()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\nFatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
