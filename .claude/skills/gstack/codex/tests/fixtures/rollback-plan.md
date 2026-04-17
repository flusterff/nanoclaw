# Rollback Test Plan

**Goal:** verify /codex implement --rollback reverts merged commits.

**Architecture:** two tasks in one wave.

**Test command:** `test -r ra.txt && test -r rb.txt`

## Parallelization

- Wave 1: Tasks 1, 2

### Task 1: first

**Files:**
- Create: `ra.txt`

- [ ] **Step 1: Create ra.txt**

Run: `true`

### Task 2: second

**Files:**
- Create: `rb.txt`

- [ ] **Step 1: Create rb.txt**

Run: `true`
