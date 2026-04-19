import requests
import json
import os
import re
import time
from bs4 import BeautifulSoup
from urllib.parse import urljoin

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
}
BASE_URL = 'https://touhou.fandom.com'
API_URL = f'{BASE_URL}/api.php'
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'touhous')

def get_all_characters():
    """Get all character page titles from the category using MediaWiki API."""
    all_members = []
    params = {
        'action': 'query',
        'list': 'categorymembers',
        'cmtitle': 'Category:Characters',
        'cmlimit': '500',
        'cmtype': 'page',
        'format': 'json'
    }
    
    while True:
        r = requests.get(API_URL, params=params, headers=HEADERS, timeout=15)
        r.raise_for_status()
        data = r.json()
        members = data.get('query', {}).get('categorymembers', [])
        all_members.extend(members)
        print(f"  Fetched {len(members)} characters (total: {len(all_members)})")
        
        if 'continue' in data:
            params['cmcontinue'] = data['continue']['cmcontinue']
        else:
            break
    
    return all_members

def get_character_image_url(page_title):
    """Get the main character image from a character's wiki page using the API."""
    # First try: get page images via API
    params = {
        'action': 'query',
        'titles': page_title,
        'prop': 'pageimages',
        'piprop': 'original',
        'format': 'json'
    }
    r = requests.get(API_URL, params=params, headers=HEADERS, timeout=15)
    r.raise_for_status()
    data = r.json()
    pages = data.get('query', {}).get('pages', {})
    for pid, pdata in pages.items():
        if 'original' in pdata:
            return pdata['original']['source']
    
    # Fallback: get page content and find the infobox image
    params2 = {
        'action': 'parse',
        'page': page_title,
        'prop': 'text',
        'format': 'json'
    }
    r2 = requests.get(API_URL, params=params2, headers=HEADERS, timeout=15)
    r2.raise_for_status()
    data2 = r2.json()
    html = data2.get('parse', {}).get('text', {}).get('*', '')
    if html:
        soup = BeautifulSoup(html, 'html.parser')
        # Look for image in infobox or first major image
        img = soup.select_one('.pi-image-thumbnail, .image img, .thumbimage')
        if img:
            src = img.get('src') or img.get('data-src')
            if src:
                # Remove thumbnail scaling to get full size
                src = re.sub(r'/revision/latest/scale-to-width-down/\d+', '/revision/latest', src)
                src = re.sub(r'/revision/latest/thumbnail/[^?]*', '/revision/latest', src)
                if src.startswith('//'):
                    src = 'https:' + src
                return src
    
    return None

def sanitize_filename(name):
    """Make a filename safe for the filesystem."""
    name = re.sub(r'[<>:"/\\|?*]', '_', name)
    name = name.strip('. ')
    return name

def download_image(url, filepath):
    """Download an image from a URL to a file."""
    r = requests.get(url, headers=HEADERS, timeout=30, stream=True)
    r.raise_for_status()
    with open(filepath, 'wb') as f:
        for chunk in r.iter_content(chunk_size=8192):
            f.write(chunk)

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    print("Step 1: Getting character list...")
    characters = get_all_characters()
    print(f"Found {len(characters)} characters total.\n")
    
    # Filter out subcategory pages if any
    characters = [c for c in characters if c.get('ns', 0) == 0]
    print(f"{len(characters)} character pages (excluding subcategories).\n")
    
    print("Step 2: Downloading character images...")
    success = 0
    failed = []
    skipped = []
    
    for i, char in enumerate(characters):
        title = char['title']
        safe_name = sanitize_filename(title)
        
        # Check if already downloaded
        existing = [f for f in os.listdir(OUTPUT_DIR) if f.startswith(safe_name + '.')]
        if existing:
            print(f"  [{i+1}/{len(characters)}] SKIP (exists): {title}")
            skipped.append(title)
            continue
        
        print(f"  [{i+1}/{len(characters)}] {title}...", end=' ', flush=True)
        
        try:
            img_url = get_character_image_url(title)
            if not img_url:
                print("NO IMAGE FOUND")
                failed.append(title)
                continue
            
            # Determine extension from URL
            ext_match = re.search(r'\.(png|jpg|jpeg|gif|webp|svg)', img_url, re.IGNORECASE)
            ext = ext_match.group(1).lower() if ext_match else 'png'
            
            filepath = os.path.join(OUTPUT_DIR, f"{safe_name}.{ext}")
            download_image(img_url, filepath)
            size_kb = os.path.getsize(filepath) / 1024
            print(f"OK ({size_kb:.0f} KB)")
            success += 1
            
            # Small delay to be nice to the server
            time.sleep(0.3)
            
        except Exception as e:
            print(f"ERROR: {e}")
            failed.append(title)
    
    print(f"\nDone! {success} downloaded, {len(skipped)} skipped, {len(failed)} failed.")
    if failed:
        print("Failed characters:")
        for f in failed:
            print(f"  - {f}")

if __name__ == '__main__':
    main()
