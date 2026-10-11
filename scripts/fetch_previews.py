"""Fill in missing link previews (image, name, price) for wishlist items.

Preview images are saved into images/ so they keep working even if the store
changes or removes them. Runs in a GitHub Action after every push, and can be
run locally with:  python3 scripts/fetch_previews.py
"""
import html
import json
import os
import re
import urllib.parse
import urllib.request

DATA_FILE = 'data/wishlist.json'
IMAGE_DIR = 'images'

# Some stores (Etsy especially) block ordinary scrapers but allow the bots that
# chat apps use to build link previews, so try those first.
USER_AGENTS = [
    'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/129.0 Safari/537.36',
]
BROWSER_UA = USER_AGENTS[-1]

EXTENSIONS = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
              'image/gif': 'gif', 'image/avif': 'avif'}


def get(url, user_agent, timeout=20):
    req = urllib.request.Request(url, headers={
        'User-Agent': user_agent,
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,image/*,*/*',
    })
    return urllib.request.urlopen(req, timeout=timeout)


def clean_text(s):
    return re.sub(r'\s+', ' ', html.unescape(s or '')).strip()


def parse_meta(page):
    meta = {}
    for tag in re.findall(r'<meta\b[^>]*>', page, re.I):
        def attr(name):
            m = re.search(r'\s%s\s*=\s*(?:"([^"]*)"|\'([^\']*)\')' % name, tag, re.I)
            return (m.group(1) if m.group(1) is not None else m.group(2)) if m else None
        key = attr('property') or attr('name') or attr('itemprop')
        content = attr('content')
        if key and content and key.lower() not in meta:
            meta[key.lower()] = clean_text(content)
    return meta


def json_ld_price(page):
    """Look through JSON-LD product data for a price."""
    for body in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', page, re.I | re.S):
        try:
            stack = [json.loads(body)]
        except ValueError:
            continue
        while stack:
            node = stack.pop()
            if isinstance(node, list):
                stack.extend(node)
            elif isinstance(node, dict):
                offers = node.get('offers')
                for offer in offers if isinstance(offers, list) else [offers]:
                    if isinstance(offer, dict):
                        price = offer.get('price', offer.get('lowPrice'))
                        if parse_price(price) is not None:
                            return price
                stack.extend(node.values())
    return None


def parse_price(value):
    if value is None:
        return None
    try:
        n = float(re.sub(r'[^0-9.]', '', str(value)))
    except ValueError:
        return None
    return round(n, 2) if n > 0 else None


def clean_name(title):
    """Store titles are often long and keyword-stuffed; trim to something readable."""
    t = clean_text(title)
    t = re.sub(r'^Amazon\.com\s*:\s*', '', t, flags=re.I)
    t = re.sub(r'\s*:\s*[^:]*Amazon\.com.*$', '', t, flags=re.I)
    t = re.sub(r'\s+[-|]\s+Etsy(\s+\w+)?$', '', t, flags=re.I)
    if len(t) > 60:
        m = re.search(r'\s[-|–—]\s|,\s', t[10:])
        if m:
            t = t[:m.start() + 10]
    return t.strip()


def parse_page(page):
    meta = parse_meta(page)
    title_tag = re.search(r'<title[^>]*>([^<]*)', page, re.I)
    result = {
        'title': meta.get('og:title') or meta.get('twitter:title') or clean_text(title_tag.group(1) if title_tag else ''),
        'image': (meta.get('og:image:secure_url') or meta.get('og:image')
                  or meta.get('twitter:image') or meta.get('twitter:image:src') or ''),
        'price': parse_price(meta.get('product:price:amount') or meta.get('og:price:amount')
                             or meta.get('price') or json_ld_price(page)),
    }
    # Amazon doesn't use the usual preview tags, so read its product page markup.
    amazon_title = re.search(r'id="productTitle"[^>]*>([^<]+)', page)
    if amazon_title:
        result['title'] = clean_text(amazon_title.group(1))
        if not result['image']:
            for pattern in (r'data-old-hires="(https:[^"]+)"', r'"hiRes":"(https:[^"]+)"',
                            r'id="landingImage"[^>]+src="(https:[^"]+)"'):
                m = re.search(pattern, page)
                if m:
                    result['image'] = m.group(1)
                    break
        if result['price'] is None:
            m = re.search(r'class="a-offscreen">\$([0-9.,]+)', page)
            result['price'] = parse_price(m.group(1)) if m else None
    if result['image'].startswith('http://'):
        result['image'] = 'https://' + result['image'][7:]
    return result


def scrape(url):
    best = {'title': '', 'image': '', 'price': None}
    for ua in USER_AGENTS:
        try:
            with get(url, ua) as res:
                found = parse_page(res.read().decode('utf-8', 'replace'))
        except Exception:
            continue  # blocked or timed out; try the next user agent
        best['title'] = best['title'] or found['title']
        best['image'] = best['image'] or found['image']
        if best['price'] is None:
            best['price'] = found['price']
        if best['title'] and best['image'] and best['price'] is not None:
            break
    if not best['title'] or not best['image']:
        # Last resort: Microlink's free preview service.
        try:
            api = 'https://api.microlink.io/?url=' + urllib.parse.quote(url, safe='')
            with get(api, BROWSER_UA, timeout=30) as res:
                body = json.load(res)
            if body.get('status') == 'success':
                data = body.get('data') or {}
                best['title'] = best['title'] or data.get('title') or ''
                best['image'] = best['image'] or (data.get('image') or {}).get('url') or ''
        except Exception:
            pass
    best['title'] = clean_name(best['title'])
    return best


def download_image(image_url, item_id):
    try:
        with get(image_url, BROWSER_UA, timeout=30) as res:
            kind = res.headers.get('Content-Type', '').split(';')[0].strip()
            if kind not in EXTENSIONS:
                return None
            path = '%s/%s.%s' % (IMAGE_DIR, item_id, EXTENSIONS[kind])
            with open(path, 'wb') as f:
                f.write(res.read())
            return path
    except Exception:
        return None


def is_remote(path):
    return bool(re.match(r'^https?://', path or ''))


def main():
    with open(DATA_FILE, encoding='utf-8') as f:
        original = f.read()
    data = json.loads(original)
    os.makedirs(IMAGE_DIR, exist_ok=True)

    for item in data['items']:
        if not item.get('previewFetched'):
            print('Fetching preview:', item['url'])
            found = scrape(item['url'])
            if not item.get('name') and found['title']:
                item['name'] = found['title']
            if item.get('price') is None and found['price'] is not None:
                item['price'] = found['price']
            if not item.get('image') and found['image']:
                item['image'] = found['image']
            item['previewFetched'] = True
        if is_remote(item.get('image')):
            saved = download_image(item['image'], item['id'])
            if saved:
                item['imageSource'] = item['image']
                item['image'] = saved
            else:
                print("  Couldn't save image for", item['url'], '- linking to it instead')

    # Remove saved images for items that have been deleted or re-imaged.
    in_use = {item.get('image') for item in data['items']}
    for name in os.listdir(IMAGE_DIR):
        path = '%s/%s' % (IMAGE_DIR, name)
        if name != '.gitkeep' and path not in in_use:
            os.remove(path)

    updated = json.dumps(data, indent=2, ensure_ascii=False) + '\n'
    if updated != original:
        with open(DATA_FILE, 'w', encoding='utf-8') as f:
            f.write(updated)
        print('Updated wishlist data.')
    else:
        print('Nothing to update.')


if __name__ == '__main__':
    main()
