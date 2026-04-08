#!/usr/bin/env python3
"""Test the vector memory service."""

import json
import time
import urllib.request

def test_service():
    base_url = "http://127.0.0.1:8765"
    
    # Test health endpoint
    try:
        with urllib.request.urlopen(f'{base_url}/health') as response:
            data = json.loads(response.read())
            print("✓ Health check passed:")
            print(json.dumps(data, indent=2))
    except Exception as e:
        print(f"✗ Health check failed: {e}")
        return False
    
    # Test memory users endpoint
    try:
        with urllib.request.urlopen(f'{base_url}/memory/users') as response:
            data = json.loads(response.read())
            print("\n✓ Memory users retrieved:")
            print(json.dumps(data, indent=2))
            
            if data['count'] > 0:
                # Test retrieving memories for first user
                user = data['users'][0]
                user_id = user['userId']
                print(f"\n✓ Found {user['memoryCount']} memories for user {user_id}")
                
                # Search for memories
                search_data = json.dumps({
                    'userId': user_id,
                    'query': '',  # Empty query returns recent
                    'limit': 5
                }).encode('utf-8')
                
                req = urllib.request.Request(
                    f'{base_url}/memory/search',
                    data=search_data,
                    headers={'Content-Type': 'application/json'},
                    method='POST'
                )
                
                with urllib.request.urlopen(req) as response:
                    data = json.loads(response.read())
                    print(f"\n✓ Search results for user {user_id}:")
                    print(f"  Found {len(data['matches'])} matches")
                    if data['matches']:
                        print(f"  First match: {data['matches'][0]['content'][:100]}...")
                        
    except Exception as e:
        print(f"✗ Memory users test failed: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    return True

if __name__ == '__main__':
    print("Testing vector memory service...\n")
    if test_service():
        print("\n✓ All tests passed!")
    else:
        print("\n✗ Some tests failed")
