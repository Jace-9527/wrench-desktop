package history

import (
	"database/sql"
	"path/filepath"
	"testing"
	"time"
)

func TestStoreCreateListDeleteClear(t *testing.T) {
	store := newTestStore(t)

	first, err := store.Create(CreateRequest{
		Tool:   "json",
		Input:  `{"a":1}`,
		Output: "{\n  \"a\": 1\n}",
	})
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == "" || first.Title == "" {
		t.Fatalf("entry was not initialized: %#v", first)
	}
	if first.CreatedAt.Location() != time.UTC {
		t.Fatalf("created time should be UTC: %s", first.CreatedAt.Location())
	}

	second, err := store.Create(CreateRequest{Tool: "base64", Input: "abc", Output: "YWJj"})
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == second.ID {
		t.Fatalf("ids should be unique: %q", first.ID)
	}

	jsonEntries, err := store.List("json", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(jsonEntries) != 1 || jsonEntries[0].Tool != "json" {
		t.Fatalf("unexpected json entries: %#v", jsonEntries)
	}

	allEntries, err := store.List("", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(allEntries) != 1 {
		t.Fatalf("limit was not applied: %#v", allEntries)
	}

	if err := store.Delete(first.ID); err != nil {
		t.Fatal(err)
	}
	jsonEntries, err = store.List("json", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(jsonEntries) != 0 {
		t.Fatalf("deleted entry still exists: %#v", jsonEntries)
	}

	if err := store.Clear(""); err != nil {
		t.Fatal(err)
	}
	all, err := store.List("", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 0 {
		t.Fatalf("clear did not remove entries: %#v", all)
	}
}

func TestStoreClearByTool(t *testing.T) {
	store := newTestStore(t)

	if _, err := store.Create(CreateRequest{Tool: "json", Input: "{}", Output: "{}"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Create(CreateRequest{Tool: "base64", Input: "abc", Output: "YWJj"}); err != nil {
		t.Fatal(err)
	}

	if err := store.Clear("json"); err != nil {
		t.Fatal(err)
	}

	jsonEntries, err := store.List("json", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(jsonEntries) != 0 {
		t.Fatalf("json entries were not cleared: %#v", jsonEntries)
	}

	base64Entries, err := store.List("base64", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(base64Entries) != 1 {
		t.Fatalf("other tool history should remain: %#v", base64Entries)
	}
}

func TestStorePersistsEntries(t *testing.T) {
	path := filepath.Join(t.TempDir(), "wrench.db")
	store, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.Create(CreateRequest{Tool: "url", Input: "a%20b", Output: "a b"})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()

	entries, err := reopened.List("url", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].ID != created.ID {
		t.Fatalf("persisted entry was not loaded: %#v", entries)
	}
}

func TestStoreSearchFiltersAndPaginates(t *testing.T) {
	store := newTestStore(t)

	entries := []CreateRequest{
		{Tool: "json", Title: "Customer payload", Input: `{"customer":"alpha"}`, Output: "formatted alpha"},
		{Tool: "json", Title: "Order payload", Input: `{"order":"bravo"}`, Output: "formatted bravo"},
		{Tool: "base64", Title: "Encoded payload", Input: "alpha", Output: "YWxwaGE="},
		{Tool: "url", Title: "Percent payload", Input: "100%25", Output: "100%"},
	}
	for _, entry := range entries {
		if _, err := store.Create(entry); err != nil {
			t.Fatal(err)
		}
	}

	jsonMatches, err := store.Search("json", "payload", 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(jsonMatches) != 2 {
		t.Fatalf("expected two json matches: %#v", jsonMatches)
	}

	inputMatches, err := store.Search("", "alpha", 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(inputMatches) != 2 {
		t.Fatalf("expected search across input/output/title: %#v", inputMatches)
	}

	firstPage, err := store.Search("", "payload", 2, 0)
	if err != nil {
		t.Fatal(err)
	}
	secondPage, err := store.Search("", "payload", 2, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(firstPage) != 2 || len(secondPage) != 2 {
		t.Fatalf("unexpected paged results: first=%#v second=%#v", firstPage, secondPage)
	}
	if firstPage[0].ID == secondPage[0].ID || firstPage[1].ID == secondPage[1].ID {
		t.Fatalf("offset returned duplicate rows: first=%#v second=%#v", firstPage, secondPage)
	}

	percentMatches, err := store.Search("", "%", 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(percentMatches) != 1 || percentMatches[0].Tool != "url" {
		t.Fatalf("percent should be searched literally: %#v", percentMatches)
	}
}

func TestStoreFavoriteSortsFirst(t *testing.T) {
	store := newTestStore(t)

	first, err := store.Create(CreateRequest{Tool: "json", Input: "first", Output: "first"})
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(time.Millisecond)
	second, err := store.Create(CreateRequest{Tool: "json", Input: "second", Output: "second"})
	if err != nil {
		t.Fatal(err)
	}

	if err := store.SetFavorite(first.ID, true); err != nil {
		t.Fatal(err)
	}
	entries, err := store.List("json", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 || entries[0].ID != first.ID || !entries[0].Favorite {
		t.Fatalf("favorite entry should sort first: %#v", entries)
	}

	if err := store.SetFavorite(first.ID, false); err != nil {
		t.Fatal(err)
	}
	entries, err = store.List("json", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 || entries[0].ID != second.ID || entries[1].Favorite {
		t.Fatalf("unfavorited entry should return to normal order: %#v", entries)
	}
}

func TestStoreMigratesFavoriteColumn(t *testing.T) {
	path := filepath.Join(t.TempDir(), "wrench.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE history_entries (
		id TEXT PRIMARY KEY,
		tool TEXT NOT NULL,
		title TEXT NOT NULL,
		input TEXT NOT NULL,
		output TEXT NOT NULL,
		created_at TEXT NOT NULL
	)`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	entry, err := store.Create(CreateRequest{Tool: "json", Input: "{}", Output: "{}"})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetFavorite(entry.ID, true); err != nil {
		t.Fatal(err)
	}
	entries, err := store.List("", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || !entries[0].Favorite {
		t.Fatalf("favorite migration did not work: %#v", entries)
	}
}

func newTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := NewStore(filepath.Join(t.TempDir(), "wrench.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Fatalf("close store: %v", err)
		}
	})
	return store
}
