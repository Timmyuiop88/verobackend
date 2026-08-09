# eSIM Access HMAC Authentication

eSIM Access supports HMAC-SHA256 request signing to authenticate API requests.

## Required Headers

Every signed request must include these headers:

| Header | Description |
|---------|-------------|
| `RT-AccessCode` | Your Access Code from the eSIM Access dashboard |
| `RT-RequestID` | A unique UUID generated for every request |
| `RT-Timestamp` | Current Unix timestamp in milliseconds |
| `RT-Signature` | HMAC-SHA256 signature |

---

## Signature Formula

The signature is created by concatenating the following values **without separators**:

```text
RT-Timestamp +
RT-RequestID +
RT-AccessCode +
RequestBody
```

Then generate an HMAC using your Secret Key.

```text
Signature = HMAC_SHA256(signData, SecretKey)
```

The result should be sent as a lowercase hexadecimal string.

---

## Example

### Request Body

```json
{
  "locationCode": "US"
}
```

### Values

```text
RT-Timestamp = 1722943123456
RT-RequestID = 5a4d6f5c-4a3e-4d2b-9e8f-c7b6a5d4e3f2
RT-AccessCode = YOUR_ACCESS_CODE
```

### signData

```text
17229431234565a4d6f5c-4a3e-4d2b-9e8f-c7b6a5d4e3f2YOUR_ACCESS_CODE{"locationCode":"US"}
```

Generate:

```text
signature = HMAC_SHA256(signData, SECRET_KEY)
```

---

## Node.js / TypeScript Example

```ts
import crypto from "crypto";
import { randomUUID } from "crypto";

const accessCode = process.env.ESIM_ACCESS_CODE!;
const secretKey = process.env.ESIM_SECRET_KEY!;

const body = JSON.stringify({
  locationCode: "US",
});

const timestamp = Date.now().toString();
const requestId = randomUUID();

const signData =
  timestamp +
  requestId +
  accessCode +
  body;

const signature = crypto
  .createHmac("sha256", secretKey)
  .update(signData)
  .digest("hex")
  .toLowerCase();
```

---

## HTTP Headers

```http
Content-Type: application/json
RT-AccessCode: YOUR_ACCESS_CODE
RT-RequestID: 5a4d6f5c-4a3e-4d2b-9e8f-c7b6a5d4e3f2
RT-Timestamp: 1722943123456
RT-Signature: 4e6d1c0c4d4b5f...
```

---

## Environment Variables

```env
ESIM_ACCESS_CODE=your_access_code
ESIM_SECRET_KEY=your_secret_key
ESIM_BASE_URL=https://api.esimaccess.com
```

---

## Authentication Flow

1. Serialize the request body to a JSON string.
2. Generate a unique `RT-RequestID` (UUID).
3. Generate the current Unix timestamp in milliseconds.
4. Concatenate:
   - `RT-Timestamp`
   - `RT-RequestID`
   - `RT-AccessCode`
   - Request body
5. Generate an HMAC-SHA256 signature using your Secret Key.
6. Convert the signature to lowercase hexadecimal.
7. Send all four authentication headers with the request.

---

## Notes

- Generate a **new `RT-RequestID` for every request**.
- Use the **exact JSON string** that is sent in the HTTP request body when computing the signature.
- Do not modify whitespace or property order after generating the signature.
- Keep your **Secret Key** private and never expose it in frontend applications.
- Perform HMAC signing only on your backend server.