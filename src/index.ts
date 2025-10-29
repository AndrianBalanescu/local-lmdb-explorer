import { serve } from "bun";
import { open } from "lmdb";
// import { search } from "../../src/index.ts";
import { db, search } from "xlmdb";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import index from "./index.html";

// Re-export open from lmdb for root database access
// xlmdb uses this internally for sub-databases

// Sample database path - can be configured via environment variable
const DB_PATH = process.env.DB_PATH || "./data";

// Store active database configurations
interface DatabaseConfig {
  name: string;
  path: string;
  collections: string[];
  dbHandle?: any; // Store the opened database handle
}

const activeDatabases = new Map<string, DatabaseConfig>();

// Store bookmarked databases
const BOOKMARKS_FILE = "./bookmarks.json";

// Load bookmarks on startup
async function loadBookmarks() {
  try {
    const file = Bun.file(BOOKMARKS_FILE);
    if (await file.exists()) {
      const data = await file.json();
      return data.bookmarks || [];
    }
  } catch (error) {
    console.log("No bookmarks file found, starting fresh");
  }
  return [];
}

// Save bookmarks
async function saveBookmarks(bookmarks: any[]) {
  const content = JSON.stringify({ bookmarks }, null, 2);
  await Bun.write(BOOKMARKS_FILE, content);
}

// Expand ~ to home directory
function expandPath(path: string): string {
  if (path.startsWith('~/') || path === '~') {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    return path.replace('~', homeDir);
  }
  return path;
}

// Find all .mdb files in a directory recursively
async function findMdbFiles(dir: string, found: Array<{ path: string; name: string }> = []) {
  try {
    const expandedDir = expandPath(dir);
    const entries = await readdir(expandedDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(expandedDir, entry.name);
      
      if (entry.isDirectory()) {
        await findMdbFiles(fullPath, found);
      } else if (entry.name.endsWith('.mdb')) {
        // Found an .mdb file, get the directory it's in
        found.push({
          path: expandedDir,
          name: entry.name
        });
      }
    }
  } catch (error) {
    // Log errors for debugging
    console.error(`Error scanning ${dir}:`, error);
  }
  
  return found;
}

// Initialize bookmarks
const bookmarks = await loadBookmarks();

// Helper to get database path
function getDatabasePath(dbName: string, customPath?: string): string {
  return customPath || DB_PATH;
}

// Helper to list collections in a database
function listCollections(dbPath: string): string[] {
  try {
    const rootDb = open({ path: dbPath, maxDbs: 1024, maxReaders: 256 });
    const keys = Array.from(rootDb.getKeys());
    rootDb.close(); // Clean up temporary connection
    return keys.map(k => String(k));
  } catch (error) {
    return [];
  }
}

const PORT = process.env.PORT || 3000;

const server = serve({
  port: typeof PORT === "string" ? parseInt(PORT, 10) : PORT,
  routes: {
    // Serve index.html for currently unmatched routes.
    "/*": index,

    "/api/databases": {
      async GET() {
        // Return all active databases
        const databases = Array.from(activeDatabases.values());
        return Response.json({ databases });
      },
    },

    "/api/scan-directories": {
      async POST(req) {
        try {
          const body = await req.json();
          const { directories } = body;

          if (!Array.isArray(directories)) {
            return Response.json({ error: "Directories must be an array" }, { status: 400 });
          }

          const found = [];
          for (const dir of directories) {
            console.log(`Scanning directory: ${dir}`);
            const results = await findMdbFiles(dir);
            console.log(`Found ${results.length} databases in ${dir}`);
            found.push(...results);
          }

          return Response.json({ databases: found });
        } catch (error) {
          console.error("Scan error:", error);
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    "/api/bookmarks": {
      async GET() {
        return Response.json({ bookmarks });
      },
      async POST(req) {
        try {
          const body = await req.json();
          const { path, name } = body;

          if (!path) {
            return Response.json({ error: "Path is required" }, { status: 400 });
          }

          // Check if already bookmarked
          const exists = bookmarks.find((b: any) => b.path === path);
          if (exists) {
            return Response.json({ error: "Already bookmarked" }, { status: 400 });
          }

          const bookmark = {
            name: name || path.split('/').pop() || "database",
            path,
            createdAt: new Date().toISOString(),
          };

          bookmarks.push(bookmark);
          await saveBookmarks(bookmarks);

          return Response.json({ bookmark });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    "/api/bookmarks/:index": {
      async DELETE(req) {
        try {
          const index = parseInt(req.params.index);
          if (isNaN(index) || index < 0 || index >= bookmarks.length) {
            return Response.json({ error: "Invalid bookmark index" }, { status: 400 });
          }

          bookmarks.splice(index, 1);
          await saveBookmarks(bookmarks);

          return Response.json({ message: "Bookmark deleted" });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    "/api/load-database": {
      async POST(req) {
        try {
          const body = await req.json();
          const { path, name } = body;

          if (!path) {
            return Response.json({ error: "Path is required" }, { status: 400 });
          }

          // Use the path as-is (already absolute from client)
          const absolutePath = path;
          
          // Check if path exists as a directory
          let pathExists = false;
          try {
            const stats = await stat(absolutePath);
            pathExists = stats.isDirectory();
          } catch (err) {
            pathExists = false;
          }
          
          if (!pathExists) {
            return Response.json({ 
              error: `Database path does not exist or is not a directory: ${absolutePath}` 
            }, { status: 400 });
          }

          // Try to open the database to verify it's valid
          try {
            // Open root database and get all sub-databases
            // Increase maxReaders to prevent connection exhaustion
            const rootDb = open({ 
              path: absolutePath, 
              maxDbs: 1024,
              maxReaders: 256 // Increased from default to handle more concurrent operations
            });
            const keys = Array.from(rootDb.getKeys());
            const collections = keys.map(k => String(k));
            
            // Don't close - we want to reuse this handle
            const dbName = name || absolutePath.split('/').pop() || "database";
            
            // Close old handle if it exists
            const oldConfig = activeDatabases.get(dbName);
            if (oldConfig?.dbHandle) {
              console.log(`Closing old database handle for: ${dbName}`);
              oldConfig.dbHandle.close();
            }
            
            activeDatabases.set(dbName, {
              name: dbName,
              path: absolutePath,
              collections,
              dbHandle: rootDb, // Store the handle for reuse
            });
            
            console.log(`Database loaded: ${dbName} at ${absolutePath}`);
            console.log(`Current active databases:`, Array.from(activeDatabases.keys()));

            return Response.json({
              message: "Database loaded successfully",
              database: {
                name: dbName,
                path: absolutePath,
                collections,
              },
            });
          } catch (error) {
            return Response.json({ error: `Invalid LMDB database: ${error}` }, { status: 400 });
          }
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    "/api/databases/:dbName/search": async (req) => {
      try {
        const dbName = req.params.dbName;
        const url = new URL(req.url);
        const query = url.searchParams.get("query") || "";
        const filterField = url.searchParams.get("filterField") || "";
        const filterOperator = url.searchParams.get("filterOperator") || "=";
        const filterValue = url.searchParams.get("filterValue") || "";
        const sortBy = url.searchParams.get("sortBy") || "";
        const sortOrder = url.searchParams.get("sortOrder") || "asc";
        const limit = parseInt(url.searchParams.get("limit") || "100");
        const customPath = url.searchParams.get("path") || "";

        // Get database path
        const dbConfig = activeDatabases.get(dbName);
        const dbPath = customPath || (dbConfig?.path) || DB_PATH;
        
        console.log(`Search request for database: ${dbName}, path: ${dbPath}`);
        console.log(`Active databases:`, Array.from(activeDatabases.keys()));

        // Get all records using xlmdb
        let results: Array<{ key: string; value: any }> = [];
        try {
          console.log(`Reading from database at: ${dbPath}`);
          
          // Reuse cached database handle or open new one with increased readers
          // Increase maxReaders to prevent MDB_READERS_FULL errors
          const rootDb = dbConfig?.dbHandle || open({ 
            path: dbPath, 
            maxDbs: 1024,
            maxReaders: 256 // Increase from default to handle more concurrent reads
          });
          const keys = Array.from(rootDb.getKeys());
          console.log(`Found ${keys.length} sub-databases`);
          
          // Build xlmdb search options
          const searchOptions: any = {
            limit: limit * 10, // Get more than limit to apply filters/sort
          };
          
          // Add filters if provided
          if (filterField && filterField !== "__none__" && filterValue) {
            searchOptions.filters = [
              (value: any) => {
                const fieldValue = value[filterField];
                
                // Try to parse as number for numeric comparisons
                const numValue = Number(filterValue);
                const isNumeric = !isNaN(numValue) && filterValue.trim() !== "";
                
                switch (filterOperator) {
                  case "=":
                    if (typeof fieldValue === "string") {
                      return fieldValue.toLowerCase() === filterValue.toLowerCase();
                    }
                    return isNumeric && typeof fieldValue === "number" 
                      ? fieldValue === numValue 
                      : String(fieldValue) === filterValue;
                    
                  case "!=":
                    if (typeof fieldValue === "string") {
                      return fieldValue.toLowerCase() !== filterValue.toLowerCase();
                    }
                    return isNumeric && typeof fieldValue === "number"
                      ? fieldValue !== numValue
                      : String(fieldValue) !== filterValue;
                    
                  case ">":
                    if (typeof fieldValue === "number") {
                      return isNumeric ? fieldValue > numValue : false;
                    }
                    return String(fieldValue) > filterValue;
                    
                  case "<":
                    if (typeof fieldValue === "number") {
                      return isNumeric ? fieldValue < numValue : false;
                    }
                    return String(fieldValue) < filterValue;
                    
                  case ">=":
                    if (typeof fieldValue === "number") {
                      return isNumeric ? fieldValue >= numValue : false;
                    }
                    return String(fieldValue) >= filterValue;
                    
                  case "<=":
                    if (typeof fieldValue === "number") {
                      return isNumeric ? fieldValue <= numValue : false;
                    }
                    return String(fieldValue) <= filterValue;
                    
                  default:
                    return true;
                }
              }
            ];
          }
          
          // Add deep search if query provided
          if (query) {
            searchOptions.deepSearch = query;
          }
          
          // Add sorting if provided
          if (sortBy && sortBy !== "__none__") {
            searchOptions.sort = sortOrder === "asc"
              ? (a: any, b: any) => {
                  const aVal = a[sortBy];
                  const bVal = b[sortBy];
                  if (typeof aVal === "string" && typeof bVal === "string") {
                    return aVal.localeCompare(bVal);
                  }
                  if (typeof aVal === "number" && typeof bVal === "number") {
                    return aVal - bVal;
                  }
                  return 0;
                }
              : (a: any, b: any) => {
                  const aVal = a[sortBy];
                  const bVal = b[sortBy];
                  if (typeof aVal === "string" && typeof bVal === "string") {
                    return bVal.localeCompare(aVal);
                  }
                  if (typeof aVal === "number" && typeof bVal === "number") {
                    return bVal - aVal;
                  }
                  return 0;
                };
          }
          
          // Process each sub-database using the root database handle (reuse connection)
          // CRITICAL: Use openDB() instead of db() to reuse the root connection and avoid reader exhaustion
          for (const key of keys) {
            try {
              // Reuse root connection - open sub-database from existing root handle
              const subDb = rootDb.openDB({ name: String(key) });
              
              // Use xlmdb search function
              const subDbResults = search(subDb, searchOptions);
              
              if (subDbResults.length > 0) {
                for (const record of subDbResults) {
                  results.push({
                    key: `${String(key)}:${record.key}`,
                    value: record.value
                  });
                }
                console.log(`Found ${subDbResults.length} records in '${String(key)}'`);
              }
            } catch (subDbError: any) {
              // Only log if it's not a reader limit error (which we handle gracefully)
              if (subDbError?.code !== -30790) {
                console.log(`Failed to read sub-database ${String(key)}:`, subDbError.message || subDbError);
              }
              // Continue with other sub-databases even if one fails
            }
          }
          
          console.log(`Total records: ${results.length}`);
        } catch (error) {
          console.error('Error reading database:', error);
          return Response.json({ 
            error: `Failed to read database: ${error}`,
            results: [],
            count: 0
          });
        }

        // Apply limit
        const limitedResults = results.slice(0, limit);

        return Response.json({
          results: limitedResults,
          count: limitedResults.length,
        });
      } catch (error) {
        return Response.json({ error: String(error) }, { status: 500 });
      }
    },

    "/api/databases/:dbName/records": async (req) => {
      try {
        const dbName = req.params.dbName;
        const url = new URL(req.url);
        const limit = parseInt(url.searchParams.get("limit") || "1000");
        const customPath = url.searchParams.get("path") || "";

        // Get database path
        const dbConfig = activeDatabases.get(dbName);
        const dbPath = customPath || (dbConfig?.path) || DB_PATH;

        // Reuse cached handle or open new one
        const rootDb = dbConfig?.dbHandle || open({ 
          path: dbPath, 
          maxDbs: 1024,
          maxReaders: 256 
        });
        
        // Get all keys from all sub-databases
        const allKeys: string[] = [];
        const keys = Array.from(rootDb.getKeys());
        
        for (const key of keys) {
          try {
            const subDb = rootDb.openDB({ name: String(key) });
            for (const { key: recordKey } of subDb.getRange()) {
              allKeys.push(`${String(key)}:${String(recordKey)}`);
            }
          } catch {}
        }

        const limitedKeys = allKeys.slice(0, limit);

        return Response.json({
          keys: limitedKeys,
          count: limitedKeys.length,
        });
      } catch (error) {
        return Response.json({ error: String(error) }, { status: 500 });
      }
    },

    "/api/databases/:dbName/records/:key": async (req) => {
      try {
        const { dbName, key } = req.params;
        const url = new URL(req.url);
        const customPath = url.searchParams.get("path") || "";

        // Get database path
        const dbConfig = activeDatabases.get(dbName);
        const dbPath = customPath || (dbConfig?.path) || DB_PATH;

        // Check if key has sub-database prefix (e.g., "adoptions:ad:1")
        if (key.includes(':')) {
          const parts = key.split(':');
          const subDbName = parts[0];
          const actualKey = parts.slice(1).join(':');
          const fullKey = actualKey;
          
          // Reuse cached handle or open new one
          const rootDb = dbConfig?.dbHandle || open({ 
            path: dbPath, 
            maxDbs: 1024,
            maxReaders: 256 
          });
          const subDb = rootDb.openDB({ name: subDbName });
          const value = subDb.get(fullKey);

          if (!value) {
            return Response.json({ error: "Record not found" }, { status: 404 });
          }

          return Response.json({ key, value });
        } else {
          // Try to get from root or any sub-database
          const rootDb = dbConfig?.dbHandle || open({ 
            path: dbPath, 
            maxDbs: 1024,
            maxReaders: 256 
          });
          
          // Try root first
          const value = rootDb.get(key);
          if (value) {
            return Response.json({ key, value });
          }
          
          // If not in root, try all sub-databases
          const keys = Array.from(rootDb.getKeys());
          for (const subDbName of keys) {
            try {
              const subDb = rootDb.openDB({ name: String(subDbName) });
              const subValue = subDb.get(key);
              if (subValue) {
                return Response.json({ key, value: subValue });
              }
            } catch {}
          }
          
          return Response.json({ error: "Record not found" }, { status: 404 });
        }
      } catch (error) {
        return Response.json({ error: String(error) }, { status: 500 });
      }
    },

    "/api/seed": {
      async POST() {
        try {
          // Seed some sample data
          const rootDb = open({ 
            path: DB_PATH, 
            maxDbs: 1024,
            maxReaders: 256 
          });
          const products = rootDb.openDB({ name: "products" });

          await products.put("p1", {
            name: "MacBook Pro",
            price: 2499,
            category: "electronics",
            description: "Powerful laptop for professionals",
            tags: ["laptop", "apple", "professional"],
            inStock: true,
          });

          await products.put("p2", {
            name: "Coffee Maker",
            price: 89,
            category: "appliances",
            description: "Automatic drip coffee maker",
            tags: ["kitchen", "coffee", "beverage"],
            inStock: true,
          });

          await products.put("p3", {
            name: "Wireless Mouse",
            price: 29,
            category: "electronics",
            description: "Ergonomic wireless mouse",
            tags: ["peripheral", "wireless", "computer"],
            inStock: false,
          });

          await products.put("p4", {
            name: "Gaming Chair",
            price: 299,
            category: "furniture",
            description: "Comfortable gaming chair with RGB",
            tags: ["gaming", "furniture", "chair"],
            inStock: true,
          });

          await products.put("p5", {
            name: "Mechanical Keyboard",
            price: 149,
            category: "electronics",
            description: "RGB mechanical keyboard with Cherry switches",
            tags: ["keyboard", "mechanical", "gaming"],
            inStock: true,
          });

      return Response.json({
            message: "Database seeded successfully",
            count: 5,
      });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
