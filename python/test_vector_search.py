#!/usr/bin/env python3
"""Test vector search with actual queries."""

import json
import urllib.request

def test_vector_search():
    base_url = "http://127.0.0.1:8766"
    
    # Get first user
    with urllib.request.urlopen(f'{base_url}/memory/users') as response:
        data = json.loads(response.read())
        if not data.get('users'):
            print("No users found")
            return
        
        user_id = data['users'][0]['userId']
        print(f"Testing with user: {user_id}")
        print(f"This user has {data['users'][0]['memoryCount']} memories\n")
    
    # Load user memories
    with urllib.request.urlopen(f'{base_url}/memory/user/{user_id}?limit=5') as response:
        user_data = json.loads(response.read())
        print(f"✓ Loaded {user_data['count']} sample memories:")
        if user_data.get('entries'):
            for i, entry in enumerate(user_data['entries'][:3], 1):
                print(f"\n  Memory {i}: {entry['content'][:100]}...")
        
        # Extract some keywords from the first memory to search for
        if user_data.get('entries'):
            first_memory = user_data['entries'][0]['content']
            words = first_memory.split()[:5]
            search_query = ' '.join(words)
            print(f"\n✓ Testing vector search with query: '{search_query}'")
            
            # Perform vector search
            search_data = json.dumps({
                'userId': user_id,
                'query': search_query,
                'limit': 3
            }).encode('utf-8')
            
            req = urllib.request.Request(
                f'{base_url}/memory/search',
                data=search_data,
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            
            with urllib.request.urlopen(req) as response:
                result = json.loads(response.read())
                print(f"\n✓ Search results: {len(result['matches'])} matches found")
                for i, match in enumerate(result['matches'][:3], 1):
                    print(f"\n  Match {i} (similarity score: {match['score']:.4f})")
                    print(f"  Author: {match['author']}")
                    print(f"  Content: {match['content'][:100]}...")

if __name__ == '__main__':
    test_vector_search()
