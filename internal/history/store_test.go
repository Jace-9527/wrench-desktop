package history

import (
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
