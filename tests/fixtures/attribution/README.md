# Attribution fixture (B7)

Three save stages of src/lib.rs for tests/b7.rs:

- `0-base.rs` – the initial commit, unattributed.
- `1-a-introduces.rs` – seat team/a adds the first and second markers.
- `2-b-moves.rs` – seat team/b moves the first marker below the closing brace
  and adds the third marker.
- `3-c-rewrites.rs` – seat team/c rewrites the second marker.

The final state is what blame must attribute: the moved first marker stays
seat a's, the rewritten marker takes seat c's, the third marker is seat b's.
