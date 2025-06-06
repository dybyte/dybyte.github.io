---
toc: true
title: "Upsert Session: Handling New Checked Exceptions"
---
## Handling `TunnelException` in Upsert Session

### Problem

In order to support upsert and delete operations using MaxCompute's `UpsertSession`, we need to call the following methods:

```java
void upsert(Record record) throws IOException, TunnelException;
void upsert(Record record, List<String> columns) throws IOException, TunnelException;
void delete(Record record) throws IOException, TunnelException;

```

However, our current `write` method is defined as:

```java
public void write(SeaTunnelRow seaTunnelRow) throws IOException;
```

Since `TunnelException` is a checked exception, we cannot directly throw it without modifying the method signature.

### Options

To resolve this, we have several choices:

1. Propagate `TunnelException` by modifying the method signature

    ```java
    public void write(SeaTunnelRow row) throws IOException, TunnelException;
    ```

    - ✅ Clearly communicates what the method may throw
    - ❌ Requires changing the interface if it's defined in a parent interface or abstract class
2. Wrap `TunnelException` in an unchecked exception

    ```java
    catch (TunnelException e) {
        throw new MaxcomputeConnectorException(CommonErrorCode.WRITER_OPERATION_FAILED, e);
    }
    
    ```

    - ✅ Does not require interface modification
    - ✅ Allows preserving the cause for debugging
    - ❌ Shifts the burden of handling the exception to the runtime
3. Convert `TunnelException` to an `IOException`

   If the semantics align, wrap it into `IOException`:

    ```java
    throw new IOException("Failed to write due to TunnelException", e);
    ```

    - ✅ Interface remains unchanged
    - ❌ Might obscure the specific cause (`TunnelException`)

In this situation, I think **option #2** is the most appropriate.

Here's the original code from `UpsertStreamImpl`:

```java
private void write(Record record, Operation op, List<String> valueColumns) throws TunnelException, IOException {
    this.checkStatus();
    List<Integer> hashValues = new ArrayList();

    Object value;
    TypeInfo typeInfo;
    for (Iterator var5 = this.hashKeys.iterator(); var5.hasNext();
         hashValues.add(TypeHasher.hash(typeInfo.getOdpsType(), value, this.session.getHasher()))) {

        int key = (Integer) var5.next();
        value = record.get(key);

        if (value == null) {
            throw new TunnelException("UpsertRecord must have primary key value. Consider providing values for column '"
                + this.schema.getColumn(key).getName() + "'");
        }

        typeInfo = this.schema.getColumn(key).getTypeInfo();
        if (typeInfo.getOdpsType() == OdpsType.DECIMAL) {
            DecimalTypeInfo decimalTypeInfo = (DecimalTypeInfo) typeInfo;
            value = new DecimalHashObject((BigDecimal) value, decimalTypeInfo.getPrecision(), decimalTypeInfo.getScale());
        }
    }

    ...
}

```

The exception thrown here is **not recoverable** — if a primary key is missing, there's nothing meaningful the system can do to fix it at runtime.

In this case, it's reasonable to convert `TunnelException` into a **runtime exception**.

---

## Reference to a Similar Case

I found a similar discussion in this PR: [apache/seatunnel#3640](https://github.com/apache/seatunnel/pull/3640)

In the PR, a reviewer suggested **unifying exceptions for connectors**, and the code was changed to:

```java
try {
    session.commit();
} catch (Exception e) {
    throw new MaxcomputeConnectorException(
        CommonErrorCodeDeprecated.WRITER_OPERATION_FAILED, e);
}

```

---

## Why catch a broader `Exception` rather than only `TunnelException`?

There are two main reasons:

1. Runtime exceptions like `NullPointerException`, `IllegalArgumentException`, or other unexpected issues may occur within the method body — even if the method declares `TunnelException`.
2. If the underlying library is updated in the future and starts throwing a new checked exception, catching `Exception` ensures the code remains compatible and avoids breaking the flow.

This is a form of defensive coding and makes the system more resilient to future changes.

> **✏️In actual operating environments, changing checked exceptions within the library to runtime exceptions may be a better choice depending on the situation.**
>