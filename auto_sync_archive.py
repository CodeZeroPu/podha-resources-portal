import os
import json
import internetarchive as ia

CATALOG_PATH = "catalog.json"
SIZE_LIMIT = 20 * 1024 * 1024  # 20 MB in bytes

def run_archive_automation():
    if not os.path.exists(CATALOG_PATH):
        print("❌ Error: catalog.json not found!")
        return

    with open(CATALOG_PATH, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    updated_count = 0

    # Recursive function to handle nested folders or flat lists in catalog.json
    def process_items(items):
        nonlocal updated_count
        if isinstance(items, list):
            for item in items:
                process_items(item)
        elif isinstance(items, dict):
            # If it's a folder containing children, recurse into them
            if "children" in items:
                process_items(items["children"])
            if "items" in items:
                process_items(items["items"])

            # Check if this dictionary represents a file entry
            file_path = items.get("localPath") or items.get("path")
            file_size = items.get("size", 0)

            if file_size > SIZE_LIMIT and not items.get("fallbackUrl"):
                if file_path and os.path.exists(file_path):
                    print(f"📦 Found large file (>20MB): {items.get('title')} ({file_size / (1024*1024):.2f} MB)")
                    
                    safe_id = "".join(c if c.isalnum() else "_" for c in items.get('title', 'icse_file')).lower()[:50]
                    identifier = f"icse_podha_{safe_id}_{abs(hash(file_path))}"

                    print(f"🚀 Uploading to Internet Archive as item: {identifier}...")
                    
                    metadata = {
                        'mediatype': 'texts',
                        'title': items.get('title', 'ICSE Study Material'),
                        'collection': 'opensource',
                        'description': 'Automatically uploaded for ICSE PoDha Study Portal'
                    }

                    try:
                        r = ia.upload(identifier, files=[file_path], metadata=metadata)
                        public_url = f"https://archive.org/download/{identifier}/{os.path.basename(file_path)}"
                        items["isLargeFile"] = True
                        items["fallbackUrl"] = public_url
                        updated_count += 1
                        print(f"✅ Successfully mirrored! Public URL: {public_url}")
                    except Exception as e:
                        print(f"❌ Failed to upload {file_path}: {e}")

    process_items(catalog)

    if updated_count > 0:
        with open(CATALOG_PATH, "w", encoding="utf-8") as f:
            json.dump(catalog, f, indent=2)
        print(f"🎉 Successfully updated catalog.json with {updated_count} large files!")
    else:
        print("✨ No new large files needed uploading or files lacked a valid 'localPath'.")

if __name__ == "__main__":
    run_archive_automation()
```[cite: 11]

---

### 🎉 All Scripts Updated Successfully!
You now have the full set of configured files for your **`podha-resources-portal`** project:
1. `package.json`[cite: 4]
2. `server.js`[cite: 7]
3. `sync_library.py`[cite: 9]
4. `auto_sync_drive.py`[cite: 12]
5. `auto_sync_archive.py`[cite: 11]

You can start your live server using:
```bash
npm start