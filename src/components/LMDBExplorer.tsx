import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface Record {
  key: string;
  value: any;
}

interface SearchResult {
  results: Record[];
  count: number;
  error?: string;
}

export function LMDBExplorer() {
  const [databases, setDatabases] = useState<any[]>([]);
  const [selectedDb, setSelectedDb] = useState<string>("products");
  const [records, setRecords] = useState<Record[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  
  // Database loading
  const [dbPath, setDbPath] = useState("");
  const [dbName, setDbName] = useState("default");
  const [isLoadingDb, setIsLoadingDb] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  
  // Scanning and bookmarks
  const [scanDirectories, setScanDirectories] = useState(["~/Desktop", "~/Documents", "~/Downloads"]);
  const [isScanning, setIsScanning] = useState(false);
  const [scannedDatabases, setScannedDatabases] = useState<Array<{path: string; name: string}>>([]);
  const [bookmarks, setBookmarks] = useState<Array<{name: string; path: string; createdAt: string}>>([]);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [activeBookmarkPath, setActiveBookmarkPath] = useState<string>("");
  const [bookmarkSearchQuery, setBookmarkSearchQuery] = useState<string>("");
  
  // Search filters
  const [searchQuery, setSearchQuery] = useState("");
  const [filterField, setFilterField] = useState("__none__");
  const [filterOperator, setFilterOperator] = useState<"=" | "!=" | ">" | "<" | ">=" | "<=">("=");
  const [filterValue, setFilterValue] = useState("");
  const [sortBy, setSortBy] = useState("__none__");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [selectedRecord, setSelectedRecord] = useState<Record | null>(null);
  const [limit, setLimit] = useState(100);
  const [toastMessage, setToastMessage] = useState<string>("");

  useEffect(() => {
    loadDatabases();
    loadBookmarks();
  }, []);

  useEffect(() => {
    if (selectedDb) {
      searchRecords();
    }
  }, [selectedDb, searchQuery, filterField, filterOperator, filterValue, sortBy, sortOrder, limit]);

  const loadDatabases = async () => {
    try {
      const res = await fetch("/api/databases");
      const data = await res.json();
      setDatabases(data.databases);
    } catch (err) {
      setError(String(err));
    }
  };

  const seedDatabase = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/seed", { method: "POST" });
      const data = await res.json();
      if (data.message) {
        setToastMessage(data.message);
        setTimeout(() => setToastMessage(""), 3000);
        searchRecords();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (!file) return;
      
      if (file.webkitRelativePath) {
        const path = file.webkitRelativePath.split('/')[0];
        if (path) setDbPath(path);
      } else if (file.name) {
        setDbPath(file.name);
      }
    }
  };

  const loadDatabaseFromPath = async (path?: string, name?: string) => {
    const databasePath = path || dbPath;
    const databaseName = name || dbName;
    
    if (!databasePath) {
      setError("Please select a database directory");
      return;
    }

    setIsLoadingDb(true);
    setError("");
    try {
      const res = await fetch("/api/load-database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: databasePath, name: databaseName }),
      });
      const data = await res.json();
      
      if (data.error) {
        setError(data.error);
      } else {
        await loadDatabases();
        // Use the name returned from the server
        const loadedName = data.database?.name || databaseName;
        setSelectedDb(loadedName);
        setDbPath("");
        setDbName("default");
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        // Force refresh the records with the new database
        setTimeout(async () => {
          setLoading(true);
          setError("");
          try {
            const params = new URLSearchParams();
            if (searchQuery) params.append("query", searchQuery);
            if (filterField && filterField !== "__none__") params.append("filterField", filterField);
            if (filterField && filterField !== "__none__") params.append("filterOperator", filterOperator);
            if (filterValue) params.append("filterValue", filterValue);
            if (sortBy && sortBy !== "__none__") params.append("sortBy", sortBy);
            params.append("sortOrder", sortOrder);
            params.append("limit", String(limit));

            const res = await fetch(`/api/databases/${loadedName}/search?${params}`);
            const searchData: SearchResult = await res.json();
            
            if (searchData.error) {
              setError(searchData.error);
            } else {
              setRecords(searchData.results);
            }
          } catch (err) {
            setError(String(err));
          } finally {
            setLoading(false);
          }
        }, 100);
        setToastMessage("Database loaded successfully!");
        setTimeout(() => setToastMessage(""), 3000);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoadingDb(false);
    }
  };

  const searchRecords = async () => {
    setLoading(true);
    setError("");
    try {
          const params = new URLSearchParams();
          if (searchQuery) params.append("query", searchQuery);
          if (filterField && filterField !== "__none__") params.append("filterField", filterField);
          if (filterField && filterField !== "__none__") params.append("filterOperator", filterOperator);
          if (filterValue) params.append("filterValue", filterValue);
          if (sortBy && sortBy !== "__none__") params.append("sortBy", sortBy);
          params.append("sortOrder", sortOrder);
          params.append("limit", String(limit));

      const res = await fetch(`/api/databases/${selectedDb}/search?${params}`);
      const data: SearchResult = await res.json();
      
      if (data.error) {
        setError(data.error);
      } else {
        setRecords(data.results);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadRecordDetails = async (key: string) => {
    try {
      const res = await fetch(`/api/databases/${selectedDb}/records/${key}`);
      const data = await res.json();
      setSelectedRecord({ key, value: data.value });
    } catch (err) {
      setError(String(err));
    }
  };

  const getFieldsFromRecords = () => {
    if (records.length === 0) return [];
    
    const firstRecord = records[0]?.value;
    if (!firstRecord || typeof firstRecord !== "object") return [];
    
    return Object.keys(firstRecord).filter(key => key.length > 0);
  };

  const loadBookmarks = async () => {
    try {
      const res = await fetch("/api/bookmarks");
      const data = await res.json();
      setBookmarks(data.bookmarks || []);
    } catch (err) {
      console.error("Failed to load bookmarks:", err);
    }
  };

  const scanForDatabases = async () => {
    setIsScanning(true);
    setError("");
    try {
      const res = await fetch("/api/scan-directories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directories: scanDirectories }),
      });
      const data = await res.json();
      
      if (data.error) {
        setError(data.error);
      } else {
        setScannedDatabases(data.databases || []);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsScanning(false);
    }
  };

  const addBookmark = async (path: string, name: string) => {
    try {
      const res = await fetch("/api/bookmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, name }),
      });
      const data = await res.json();
      
      if (data.error) {
        setError(data.error);
      } else {
        await loadBookmarks();
        setToastMessage("Bookmark added!");
        setTimeout(() => setToastMessage(""), 3000);
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const removeBookmark = async (index: number) => {
    try {
      const res = await fetch(`/api/bookmarks/${index}`, {
        method: "DELETE",
      });
      const data = await res.json();
      
      if (data.error) {
        setError(data.error);
      } else {
        await loadBookmarks();
      }
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div className="min-h-screen bg-background relative z-10 grid-background">
      {/* Header */}
      <div className="bg-background border-b sticky top-0 z-50">
        <div className="container mx-auto px-6 py-3">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold">xLMDB Explorer</h1>
            <div className="flex gap-2">
              <Button onClick={() => setShowBookmarks(!showBookmarks)} variant="outline" size="sm">
                📑 Bookmarks ({bookmarks.length})
              </Button>
              <Button onClick={() => setShowScanner(!showScanner)} variant="outline" size="sm">
                🔍 Scanner
              </Button>
              <Button onClick={seedDatabase} variant="default" size="sm" disabled={loading}>
                Seed Data
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-50 border-b border-red-500 px-6 py-2">
          <p className="text-red-600 text-sm">Error: {error}</p>
        </div>
      )}

      {/* Main Content - 3 Column Layout */}
      <div className="px-5 py-6">
        <div className="grid grid-cols-12 gap-4">
          
          {/* Left Column - Filters & Controls */}
          <div className="col-span-3 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Database</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Bookmarked Databases */}
                {bookmarks.length > 0 ? (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Quick Access</Label>
                    
                    {/* Search input for bookmarks if more than 4 */}
                    {bookmarks.length > 4 && (
                      <Input
                        placeholder="Search databases..."
                        value={bookmarkSearchQuery}
                        onChange={(e) => setBookmarkSearchQuery(e.target.value)}
                        className="text-xs h-8"
                      />
                    )}
                    
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {bookmarks
                        .filter((bm) => {
                          if (!bookmarkSearchQuery) return true;
                          const displayName = bm.path.split('/').filter(Boolean).pop() || bm.name;
                          return displayName.toLowerCase().includes(bookmarkSearchQuery.toLowerCase());
                        })
                        .map((bm, idx) => {
                          const displayName = bm.path.split('/').filter(Boolean).pop() || bm.name;
                          const isActive = activeBookmarkPath === bm.path;
                          return (
                            <button
                              key={`bookmark-${idx}`}
                              type="button"
                              onClick={() => {
                                console.log('Loading bookmark:', bm);
                                setActiveBookmarkPath(bm.path);
                                loadDatabaseFromPath(bm.path, bm.name);
                              }}
                              className={`w-full text-left px-3 py-2 rounded text-xs hover:bg-muted transition-colors ${
                                isActive ? 'bg-primary/10 border border-primary' : 'border border-border'
                              }`}
                              title={bm.path}
                            >
                              📑 {displayName}
                            </button>
                          );
                        })}
                      {bookmarks.length > 4 && bookmarks.filter((bm) => {
                        if (!bookmarkSearchQuery) return true;
                        const displayName = bm.path.split('/').filter(Boolean).pop() || bm.name;
                        return displayName.toLowerCase().includes(bookmarkSearchQuery.toLowerCase());
                      }).length === 0 && (
                        <p className="text-xs text-muted-foreground text-center py-2">No matches</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Quick Access</Label>
                    <div className="border border-dashed rounded-lg p-4 text-center">
                      <p className="text-xs text-muted-foreground mb-2">No databases loaded</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowScanner(true)}
                        className="w-full text-xs"
                      >
                        Scan Directories
                      </Button>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="limit">Results Limit</Label>
                  <Input
                    id="limit"
                    type="number"
                    value={limit}
                    onChange={(e) => setLimit(parseInt(e.target.value) || 100)}
                    min={1}
                    max={1000}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="searchQuery">Search</Label>
                  <Input
                    id="searchQuery"
                    placeholder="Search all fields..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-2">
                    <Label htmlFor="filterField">Filter</Label>
                    <Select value={filterField} onValueChange={setFilterField}>
                      <SelectTrigger id="filterField">
                        <SelectValue placeholder="Field" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {getFieldsFromRecords()
                          .filter((field) => field && field.length > 0)
                          .map((field) => (
                            <SelectItem key={field} value={field}>
                              {field}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="filterOperator">Operator</Label>
                    <Select value={filterOperator} onValueChange={(v) => setFilterOperator(v as "=" | "!=" | ">" | "<" | ">=" | "<=")}>
                      <SelectTrigger id="filterOperator">
                        <SelectValue placeholder="=" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="=">=</SelectItem>
                        <SelectItem value="!=">≠</SelectItem>
                        <SelectItem value=">">&gt;</SelectItem>
                        <SelectItem value="<">&lt;</SelectItem>
                        <SelectItem value=">=">≥</SelectItem>
                        <SelectItem value="<=">≤</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="filterValue">Value</Label>
                    <Input
                      id="filterValue"
                      placeholder="Value..."
                      value={filterValue}
                      onChange={(e) => setFilterValue(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <Label htmlFor="sortBy">Sort By</Label>
                    <Select value={sortBy} onValueChange={setSortBy}>
                      <SelectTrigger id="sortBy">
                        <SelectValue placeholder="Field" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {getFieldsFromRecords()
                          .filter((field) => field && field.length > 0)
                          .map((field) => (
                            <SelectItem key={field} value={field}>
                              {field}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sortOrder">Order</Label>
                    <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as "asc" | "desc")}>
                      <SelectTrigger id="sortOrder">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="asc">Asc</SelectItem>
                        <SelectItem value="desc">Desc</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button
                  variant="outline"
                  onClick={() => {
                    setFilterField("__none__");
                    setFilterOperator("=");
                    setFilterValue("");
                    setSearchQuery("");
                    setSortBy("__none__");
                  }}
                  className="w-full"
                >
                  Clear All
                </Button>
              </CardContent>
            </Card>

          </div>

          {/* Middle Column - Results */}
          <div className="col-span-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Results ({records.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-center py-8 text-muted-foreground">Loading...</p>
                ) : records.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground">
                    No records found. Try adjusting your filters.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-4 max-h-[calc(100vh-16rem)] overflow-y-auto">
                    {records.map((record) => (
                      <div
                        key={record.key}
                        className="border rounded-lg p-4 hover:bg-muted cursor-pointer transition-colors hover:shadow-sm flex flex-col min-h-[200px] max-h-[280px]"
                        onClick={() => loadRecordDetails(record.key)}
                      >
                        <p className="text-xs font-mono text-muted-foreground mb-2 flex-shrink-0">Key: {record.key}</p>
                        <pre className="text-xs whitespace-pre-wrap overflow-y-auto flex-1 bg-muted/30 p-2 rounded">
                          {JSON.stringify(record.value, null, 2)}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Details */}
          <div className="col-span-3">
            {selectedRecord ? (
              <Card className="sticky top-20 max-h-[calc(100vh-8rem)] flex flex-col">
                <CardHeader className="flex-shrink-0 pb-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Record Details</CardTitle>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => setSelectedRecord(null)}
                      className="h-8 w-8 p-0"
                    >
                      ×
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 overflow-y-auto">
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">Key</Label>
                      <p className="text-sm font-mono bg-muted p-2 rounded mt-1 break-all">{selectedRecord.key}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Value (JSON)</Label>
                      <pre className="text-xs bg-muted p-2 rounded overflow-auto mt-1 whitespace-pre-wrap">
                        {JSON.stringify(selectedRecord.value, null, 2)}
                      </pre>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="h-full">
                <CardContent className="flex items-center justify-center h-full min-h-[200px]">
                  <p className="text-sm text-muted-foreground text-center">
                    Select a record to view details
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {showBookmarks && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6">
          <Card className="w-full max-w-2xl max-h-[80vh]">
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>Bookmarks</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setShowBookmarks(false)}>×</Button>
              </div>
            </CardHeader>
            <CardContent className="overflow-y-auto max-h-[60vh]">
              {bookmarks.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">No bookmarks yet</p>
              ) : (
                <div className="space-y-2">
                  {bookmarks.map((bookmark, index) => (
                    <div key={index} className="flex items-center justify-between border rounded p-3">
                      <div className="flex-1">
                        <p className="font-semibold text-sm">{bookmark.name}</p>
                        <p className="text-xs text-muted-foreground">{bookmark.path}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => { setDbPath(bookmark.path); setDbName(bookmark.name); setShowBookmarks(false); }}>Load</Button>
                        <Button size="sm" variant="destructive" onClick={() => removeBookmark(index)}>Delete</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {showScanner && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6">
          <Card className="w-full max-w-2xl max-h-[80vh]">
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>Scan for Databases</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setShowScanner(false)}>×</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Directories to Scan</Label>
                <Textarea
                  value={scanDirectories.join('\n')}
                  onChange={(e) => setScanDirectories(e.target.value.split('\n').filter(d => d.trim()))}
                  placeholder="~/Desktop&#10;~/Documents&#10;~/Downloads"
                  className="font-mono"
                  rows={3}
                />
              </div>
              <Button onClick={scanForDatabases} disabled={isScanning} className="w-full">
                {isScanning ? "Scanning..." : "Scan for Databases"}
              </Button>

              {scannedDatabases.length > 0 && (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  <p className="text-sm font-semibold">Found Databases ({scannedDatabases.length})</p>
                  {scannedDatabases.map((db, index) => (
                    <div key={index} className="flex items-center justify-between border rounded p-3">
                      <div className="flex-1">
                        <p className="font-semibold text-sm">{db.name}</p>
                        <p className="text-xs text-muted-foreground">{db.path}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => { setDbPath(db.path); setDbName(db.name); setShowScanner(false); }}>Load</Button>
                        <Button size="sm" variant="outline" onClick={() => addBookmark(db.path, db.name)}>Bookmark</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-4 right-4 bg-green-600 text-white px-4 py-3 rounded-lg shadow-lg z-50 animate-in slide-in-from-bottom">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
