#!/usr/bin/env python3
"""Test the new vector memory service on port 8766."""

import json
import urllib.request

def test_service():
    base_url = "http://127.0.0.1:8766"
    
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
            print(f"  Found {data['count']} users with memories")
            
            if data.get('users'):
                # Show first few users
                for user in data['users'][:3]:
                    print(f"  - User {user['userId']}: {user['memoryCount']} memories")
                
                # Test search for first user
                user = data['users'][0]
                user_id = user['userId']
                
                search_data = json.dumps({
                    'userId': user_id,
                    'query': '',  # Empty query returns recent
                    'limit': 3
                }).encode('utf-8')
                
                req = urllib.request.Request(
                    f'{base_url}/memory/search',
                    data=search_data,
                    headers={'Content-Type': 'application/json'},
                    method='POST'
                )
                
                with urllib.request.urlopen(req) as response:
                    search_result = json.loads(response.read())
                    print(f"\n✓ Memory search for user {user_id}:")
                    print(f"  Found {len(search_result['matches'])} matches")
                    if search_result['matches']:
                        match = search_result['matches'][0]
                        print(f"  Recent memory (score: {match['score']}): \n    {match['content'][:80]}...")
                        print(f"    Author: {match['author']}, Timestamp: {match['timestamp']}")
                
    except Exception as e:
        print(f"✗ Memory users/search test failed: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    return True

if __name__ == '__main__':
    print("Testing NEW vector memory service on port 8766...\n")
    if test_service():
        print("\n✓ All tests passed!")
    else:
        print("\n✗ Some tests failed")
