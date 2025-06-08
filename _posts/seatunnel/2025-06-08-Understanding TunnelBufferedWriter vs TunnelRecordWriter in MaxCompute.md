---
toc: true
title: "Understanding TunnelBufferedWriter vs TunnelRecordWriter in MaxCompute"
---
# Understanding TunnelBufferedWriter vs TunnelRecordWriter in MaxCompute

When uploading data via the **MaxCompute Tunnel SDK**, there are two primary writer classes available:

- `TunnelBufferedWriter`
- `TunnelRecordWriter`

While both are used to write records into a table, they differ significantly in how they manage block IDs and ensure thread safety. This post explores the differences and implications of choosing one over the other.

---

## 🧱 What Is a "Block"?

In the context of the Tunnel SDK, a **block** is a unit of data written to MaxCompute in one session. Instead of writing row-by-row in real-time, data is accumulated and pushed in blocks for performance and consistency.

---

## 🧠 Core Difference: Block ID Management

- `openRecordWriter(blockId)` manually opens a block writer for the given ID.
- `TunnelBufferedWriter` automatically manages block IDs behind the scenes.


### `TunnelRecordWriter`

- **You must manually assign a `blockId`** when writing.
- Example:
  ```java
  TunnelRecordWriter writer = session.openRecordWriter(0L);
  writer.write(record);
  writer.close();
  session.commit(new Long[] {0L});
  ```

 ```java
// TableTunnel.UploadSession.java
  private RecordWriter openRecordWriterInternal(long blockId, CompressOption compress, long blockVersion) throws TunnelException {
    TunnelRetryHandler retryHandler = new TunnelRetryHandler(this.conf);

    try {
        return (RecordWriter)retryHandler.executeWithRetry(() -> {
            Connection conn = null;

            IOException e;
            try {
                e = null;
                conn = this.getConnection(blockId, compress, blockVersion);
                TunnelRecordWriter writer = new TunnelRecordWriter(this.schema, conn, compress);
                writer.setTransform(this.shouldTransform);
                return writer;
            } catch (IOException var10) {
                e = var10;
                if (conn != null) {
                    try {
                        conn.disconnect();
                    } catch (IOException var9) {
                    }
                }

                throw e;
            }
        });
    } catch (RuntimeException var8) {
        RuntimeException re = var8;
        throw re;
    } catch (Exception var9) {
        Exception e = var9;
        throw new TunnelException(e.getMessage(), e);
    }
}
```

An upload session opens a new RecordWriter for a specific block ID provided manually.

### `TunnelBufferedWriter`
Automatically assigns and manages blockIds via internal counters.

Uses a synchronized method like:

```java
 //TunnelBufferedWriter.java
public void flush() throws IOException {
  this.checkStatus();
  long delta = this.bufferedPack.getTotalBytesWritten();
  if (delta > 0L) {
    Long blockId = this.session.getAvailBlockId();
    long version = 0L;
    if (this.versionProvider != null) {
      version = this.versionProvider.generateVersion(blockId);
    }

    if (this.versionProvider != null) {
      try {
        this.session.writeBlock(blockId, this.bufferedPack, this.timeout, version);
      } catch (TunnelException var7) {
        TunnelException e = var7;
        throw new IOException("Generate block version invalid", e);
      }
    } else {
      this.session.writeBlock(blockId, this.bufferedPack, this.timeout);
    }

    this.bufferedPack.reset();
    this.bytesWritten += delta;
  }

}
```
```java
//TableTunnel.java
public synchronized Long getAvailBlockId() {
    if (this.curBlockId >= this.totalBLocks) {
        throw new RuntimeException("No more available blockId, already " + this.curBlockId);
    } else {
        Long old = this.curBlockId;
        this.curBlockId = this.curBlockId + this.shares;
        return old;
    }
}
```
This ensures that even in multithreaded environments, block IDs are allocated safely.

## 🔐 Thread Safety Considerations
### With `TunnelRecordWriter`
You are in charge of assigning block IDs. This means:

- In concurrent environments, collisions can happen unless you manually synchronize access.

- It’s prone to human error when used across multiple threads or workers.

### With `TunnelBufferedWriter`
The writer:

- Internally manages block IDs

- Guarantees thread-safe ID allocation using synchronized

- Provides a more robust experience for parallelized or distributed writing tasks

## ✅ What Does session.commit() Actually Do?
### With `TunnelRecordWriter`
You must explicitly commit the block(s) you've written:

```java
session.commit(new Long[] {blockId});
```
Internally, the method verifies:

- The blocks you provided match those uploaded to the server

- Each provided block exists on the server

- Fails if there's a mismatch

### With `TunnelBufferedWriter`
Since block IDs are internally managed and tracked:

You can simply call:

```java
session.commit();
```

The SDK already knows which blocks were uploaded, and performs the finalization accordingly

> While commit() may seem simpler, it's best used when block IDs are managed by the SDK (e.g., via TunnelBufferedWriter). For more strict validation and manual block control (e.g., when using TunnelRecordWriter), prefer commit(blocks) to avoid silent mismatches.

## 📝 Takeaway
Both TunnelBufferedWriter and TunnelRecordWriter serve valid use cases, but understanding their differences in block management and thread safety is key to choosing the right tool.

If you're building a scalable data pipeline or handling concurrent writes, prefer TunnelBufferedWriter. For single-threaded or fine-grained control, TunnelRecordWriter gives you more flexibility—at the cost of more responsibility.