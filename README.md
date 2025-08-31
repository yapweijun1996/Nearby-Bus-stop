# Nearby Bus Stop

A simple web application to discover nearby bus stops based on your current location or a searched address.

## Features

- Get current location using browser geolocation
- Search for addresses using Nominatim API
- Fetch nearby bus stops within 1km using Overpass API
- Display locations on an interactive map using Leaflet
- Links to bus arrival times for each stop

## How to Use

1. Open `index.html` in a web browser.
2. Allow location access when prompted, or click "Update Location".
3. Alternatively, enter an address in the search box and click "Search".
4. View your location and nearby bus stops on the map.
5. Click on bus stop markers for more info and links to arrival times.

## Technologies Used

- HTML5
- JavaScript (ES6)
- Leaflet for maps
- OpenStreetMap tiles
- Nominatim API for address search
- Overpass API for bus stop data
- BigDataCloud API for locality info

## API Details

### Overpass API
The Overpass API is a read-only API that allows querying OpenStreetMap (OSM) data using a custom query language. It retrieves geospatial data like bus stops based on tags and locations. It's free to use but has rate limits (e.g., 1 request per second per IP) and timeouts for complex queries. For business use, it's suitable for low to moderate traffic applications, but for high-volume use, consider caching results or using a commercial OSM service. It's safe as it only provides public OSM data, but data accuracy depends on community contributions and may not be real-time.

### Nominatim API
Nominatim is OSM's geocoding service for address search and reverse geocoding. It's free with rate limits (e.g., 1 request per second). Suitable for business with proper caching; safe for public data.

### BigDataCloud API
Provides reverse geocoding for locality info. Has a free tier with limits; check terms for business use. Safe for public data.

## Explanation of Bus Stop Location Feature

The app uses the Overpass API to query OpenStreetMap data for bus stops and platforms within a 1km radius of the user's location. It constructs a query to find nodes with "highway"="bus_stop" or "public_transport"="platform" tags. The results are displayed as markers on the map, with popups showing bus stop codes and names, and links to a separate bus arrival time service.