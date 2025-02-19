# Pinpoint

This repo hosts **pinpoint.ts**, a cross-platform script that bulk geocodes
U.S. street addresses. It reads addresses from a CSV file, looks up their
coordinates with [Nominatim](https://nominatim.org/) by default (or another
service if you set `GEOCODER_URL`), and writes results to a GeoJSON file.

### Requirements
- [Bun](https://bun.sh/)  
- A CSV file with **4 required columns**: `practiceId`, `departmentId`, `zip`, and `minimalAddress`

### Setup
1. **Install Bun**: See [Bun installation docs](https://bun.sh/docs/install).
2. **Clone or download** this repository.
3. **Install dependencies**:
   ```bash
   bun install
   ```
4. **Optionally, override the default geocoder URL**:
   ```bash
   export GEOCODER_URL=https://another-geocode-service.com/search
   ```

### Usage
Run the script with Bun:
```bash
bun run pinpoint.ts <addresses.csv>
```
The script reads addresses from the CSV and will produce `<addresses.csv>.sql`
and `<addresses.csv>.geojson` files in the same folder.

### What It Does
1. Reads each row of the CSV to get `minimalAddress` (and `zip` if needed).
2. Calls the geocoding service (Nominatim by default).
3. Logs a sample SQL `UPDATE` statement for each found coordinate.
4. Writes a GeoJSON file with point features of all geocoded addresses.

### Example CSV
```
practiceId,departmentId,zip,minimalAddress
100,200,12345,"123 Main St Anytown"
101,201,67890,"456 Oak Ave"
```

### Additional Notes
- The script uses a 300 ms pause between geocoding requests to help avoid rate-limiting.
- For large CSVs or more stringent rate limits, you can increase that delay.
- Always check and follow the usage policies of any geocoding service you use.
