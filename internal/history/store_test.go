package history

import (
	"path/filepath"
	"testing"
)

func TestStoreCreateListDeleteClear(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "history.jsonl"))
	if err != nil {
		t.Fatal(err)
	}

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

	if _, err := store.Create(CreateRequest{Tool: "base64", Input: "abc", Output: "YWJj"}); err != nil {
		t.Fatal(err)
	}

	jsonEntries, err := store.List("json", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(jsonEntries) != 1 || jsonEntries[0].Tool != "json" {
		t.Fatalf("unexpected json entries: %#v", jsonEntries)
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
