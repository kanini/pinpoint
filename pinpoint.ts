import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import prompts from 'prompts';

// ------------------------------------------------------------------------
// Types
// ------------------------------------------------------------------------
export interface DataRow {
  minimalAddress?: string;
  zip?: string;
  practiceId?: string;
  departmentId?: string;
}

export interface Coordinates {
  lat: number;
  lon: number;
}

// ------------------------------------------------------------------------
// Globals & State
// ------------------------------------------------------------------------
const results: DataRow[] = [];
const geoJSONFeatures: any[] = [];
const sqlStatements: string[] = [];

// Use Nominatim by default, override with GEOCODER_URL if set
const geocoderUrl = process.env.GEOCODER_URL || "https://nominatim.openstreetmap.org/search";

// ------------------------------------------------------------------------
// Utility: Prompt user for Yes/No
// ------------------------------------------------------------------------
async function askYesNo(question: string): Promise<boolean> {
  if (process.env.NODE_ENV === 'test') {
    console.log("-- Test environment: auto-confirming yes for prompt:", question);
    return true;
  }
  const response = await prompts({
    type: 'confirm',
    name: 'value',
    message: question,
    initial: true
  });
  return response.value;
}

// ------------------------------------------------------------------------
// Exported Functions (for testing or advanced usage)
// ------------------------------------------------------------------------
export async function geocodeAddress(
  query: string,
  rowNumber: number,
  isZip = false
): Promise<Coordinates | null> {
  const url = `${geocoderUrl}?q=${encodeURIComponent(query)}&format=json`;
  console.log(`-- Geocode URL: ${url}`);

  // Attempt to fetch with a 5-second timeout
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      console.log(`-- ROW ${rowNumber}: Request failed with status ${response.status}`);
      return null;
    }
    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon),
      };
    } else {
      console.log(`-- ROW ${rowNumber}: No results found`);
      return null;
    }
  } catch (error) {
    console.error(`-- ROW ${rowNumber}: Error calling geocoder: ${String(error)}`);
    return null;
  } finally {
    clearTimeout(id);
  }
}

export async function processAddresses(data: DataRow[], sqlPath: string, geoJSONPath: string): Promise<void> {
  console.log(`-- Debug: processAddresses() called with ${data.length} rows`);
  let firstGeocodeFailure = true;
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowNumber = i + 1;
    console.log(`-- Processing row ${rowNumber}:`);

    const practiceIdNum = parseInt(row.practiceId, 10);
    if (isNaN(practiceIdNum) || practiceIdNum < 0) {
      console.error(`-- ROW ${rowNumber}: Invalid practiceId: must be integer >= 0, got [${row.practiceId}]`);
      process.exit(1);
    }

    const departmentIdNum = parseInt(row.departmentId, 10);
    if (isNaN(departmentIdNum) || departmentIdNum < 0) {
      console.error(`-- ROW ${rowNumber}: Invalid departmentId: must be integer >= 0, got [${row.departmentId}]`);
      process.exit(1);
    }

    const zip = row.zip;
    if (typeof zip !== 'string' || zip.length < 5) {
      console.error(`-- ROW ${rowNumber}: Invalid zip: must be string of length >= 5, got [${zip}]`);
      process.exit(1);
    }

    const address = row.minimalAddress;
    if (typeof address !== 'string' || address.length < 5) {
      console.error(`-- ROW ${rowNumber}: Invalid minimalAddress: must be string of length >= 5, got [${address}]`);
      process.exit(1);
    }

    // --------------------------------------------------------
    // Write comment lines to the SQL output
    // --------------------------------------------------------
    sqlStatements.push(`-- Processing row ${rowNumber}:`);
    sqlStatements.push(`-- Address: "${address}"`);

    // Attempt with full address
    const addressUrl = `${geocoderUrl}?q=${encodeURIComponent(address)}&format=json`;
    sqlStatements.push(`-- Geocode URL: ${addressUrl}`);

    let coordinates = await geocodeAddress(address, rowNumber);

    // Try again with zip if needed
    if (!coordinates) {
      sqlStatements.push(`-- Trying again with only the ZIP code...`);
      sqlStatements.push(`-- Zip: "${zip}"`);
      const zipUrl = `${geocoderUrl}?q=${encodeURIComponent(zip)}&format=json`;
      sqlStatements.push(`-- Geocode URL: ${zipUrl}`);

      coordinates = await geocodeAddress(zip, rowNumber, true);
      if (!coordinates) {
        sqlStatements.push(`-- Fallback to Zip FAILED. No location found.`);
      }
    }

    if (coordinates) {
      const { lat, lon } = coordinates;
      console.log(`-- Coordinates: ${lat}, ${lon}`);
      sqlStatements.push(`-- Coordinates from geocoder: ${lat}, ${lon}`);

      const sqlStatement = `UPDATE paDepartmentsRoster SET latitude=${lat}, longitude=${lon} WHERE practiceId=${practiceIdNum} AND departmentId=${departmentIdNum} AND (latitude IS NULL OR longitude IS NULL OR latitude < 15 OR latitude > 75 OR longitude < -180 OR longitude > -60);`;
      console.log(sqlStatement);
      sqlStatements.push(sqlStatement);

      // Add feature to GeoJSON
      geoJSONFeatures.push({
        type: 'Feature',
        id: rowNumber,
        properties: { Address: address },
        geometry: {
          type: 'Point',
          coordinates: [lon, lat],
        },
      });
    } else {
      // If no coordinates found, do nothing special here except logs.
      if (firstGeocodeFailure) {
        firstGeocodeFailure = false;
        console.log("-- Geocoding request(s) failed. Check network or geocoder availability.");
        const proceed = await askYesNo("Continue anyway? (Y/n)");
        if (!proceed) {
          console.log("-- Exiting without writing output.");
          process.exit(1);
        }
      }
    }

    sqlStatements.push(`-- ~~~~~~~`);
    console.log('-- ~~~~~~~'); // Separator between rows

    // delay between requests to avoid rate-limiting
    if (process.env.NODE_ENV !== 'test') {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  // Write all results
  saveSQL(sqlPath);
  saveGeoJSON(geoJSONPath);
}

// ------------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------------
function saveSQL(filename: string): void {
  if (!sqlStatements.length) {
    console.log("-- No SQL statements were generated.");
    return;
  }
  try {
    fs.writeFileSync(filename, sqlStatements.join("\n") + "\n", { encoding: "utf8" });
    console.log(`-- SQL file saved as ${filename}`);
  } catch (err) {
    console.error('-- Error writing SQL file:', err);
  }
}

function saveGeoJSON(filename: string): void {
  const geoJSON = {
    type: 'FeatureCollection',
    features: geoJSONFeatures,
  };

  try {
    fs.writeFileSync(filename, JSON.stringify(geoJSON, null, 2), { encoding: "utf8" });
    console.log(`-- GeoJSON file saved as ${filename}`);
  } catch (err) {
    console.error('-- Error writing GeoJSON file:', err);
  }
}

// ------------------------------------------------------------------------
// CLI Entry Point
// ------------------------------------------------------------------------
async function main() {
  console.log("-- Debug: Entered main() with argv:", process.argv);
  const csvFileArg = process.argv[2];
  if (!csvFileArg) {
    console.error("Usage: bun run pinpoint.ts <addresses.csv>");
    process.exit(1);
  }

  // Resolve paths
  const csvFilePath = path.resolve(csvFileArg);
  if (!fs.existsSync(csvFilePath)) {
    console.error(`CSV file not found: ${csvFilePath}`);
    process.exit(1);
  }

  // Derive output filenames
  const sqlFilePath = csvFilePath + ".sql";
  const geoJSONFilePath = csvFilePath + ".geojson";

  // Check if outputs already exist
  if (fs.existsSync(sqlFilePath) || fs.existsSync(geoJSONFilePath)) {
    console.error("Error: One or both output files already exist:");
    if (fs.existsSync(sqlFilePath)) {
      console.error(" - " + sqlFilePath);
    }
    if (fs.existsSync(geoJSONFilePath)) {
      console.error(" - " + geoJSONFilePath);
    }
    console.error("Remove or rename these files and try again.");
    process.exit(1);
  }

  // Ask user if it's OK to write these two files
  console.log(`Pinpoint will attempt to write the following files:\n* ${sqlFilePath}\n* ${geoJSONFilePath}`);
  const proceed = await askYesNo("Continue? (Y/n)");
  if (!proceed) {
    console.log("-- Exiting without processing.");
    process.exit(1);
  }

  // Read CSV
  fs.createReadStream(csvFilePath)
    .pipe(csv())
    .on('data', (row) => {
      results.push(row);
    })
    .on('end', () => {
      processAddresses(results, sqlFilePath, geoJSONFilePath)
        .catch(err => {
          console.error("-- Unexpected error in processAddresses:", err);
          process.exit(1);
        });
    });
}

// If this file is being called directly, run main():
if (import.meta.main) {
  main().catch(err => {
    console.error("-- Unexpected error in main():", err);
    process.exit(1);
  });
}