/**
 * Arcade Post-Execution PII Redactor
 *
 * Designed to run as a Cloudflare Worker.
 *
 * Endpoints:
 *   GET  /health
 *   POST /post
 *
 * The /post endpoint inspects Arcade's tool output
 * and redacts phone numbers recursively.
 */

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // ---------------------------------------------------------
    // Health check
    // ---------------------------------------------------------
    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({
        status: "ok",
        service: "arcade-pii-redactor"
      });
    }

    // ---------------------------------------------------------
    // Arcade Post-Execution Hook
    // ---------------------------------------------------------
    if (request.method === "POST" && url.pathname === "/post") {
      try {
        const body = await request.json();

        console.log(
          JSON.stringify({
            event: "post_hook_received",
            execution_id: body.execution_id,
            tool: body.tool?.name
          })
        );

        // Nothing to redact if the tool did not return output
        if (body.output === undefined || body.output === null) {
          return jsonResponse({
            code: "OK"
          });
        }

        const redactedOutput = redactPII(body.output);

        return jsonResponse({
          code: "OK",
          override: {
            output: redactedOutput
          }
        });

      } catch (error) {
        console.error("Error processing request:", error);

        return jsonResponse(
          {
            code: "CHECK_FAILED",
            error_message: "Unable to process post-execution output"
          },
          500
        );
      }
    }

    // ---------------------------------------------------------
    // Anything else
    // ---------------------------------------------------------
    return jsonResponse(
      {
        error: "Not Found"
      },
      404
    );
  }
};


/**
 * Recursively walk through an object/array/string and redact PII.
 *
 * This means Salesforce responses can contain nested objects,
 * arrays of contacts, records, etc.
 */
function redactPII(value) {

  // String
  if (typeof value === "string") {
    return redactString(value);
  }

  // Array
  if (Array.isArray(value)) {
    return value.map(item => redactPII(item));
  }

  // Object
  if (value !== null && typeof value === "object") {
    const result = {};

    for (const [key, item] of Object.entries(value)) {

      /*
       * Salesforce often exposes fields whose semantic
       * name already tells us that they contain a phone
       * number.
       *
       * Examples:
       * Phone
       * MobilePhone
       * OtherPhone
       * HomePhone
       */
      if (isPhoneField(key) && item !== null) {
        result[key] = "[PHONE REDACTED]";
      } else {
        result[key] = redactPII(item);
      }
    }

    return result;
  }

  // number / boolean / null
  return value;
}


/**
 * Identify common phone-related field names.
 */
function isPhoneField(key) {
  const normalized = key
    .toLowerCase()
    .replace(/[_\-\s]/g, "");

  return (
    normalized === "phone" ||
    normalized === "phonenumber" ||
    normalized === "telephone" ||
    normalized === "mobile" ||
    normalized === "mobilephone" ||
    normalized === "homephone" ||
    normalized === "otherphone" ||
    normalized === "businessphone" ||
    normalized === "workphone" ||
    normalized === "fax"
  );
}


/**
 * Redact phone-like values embedded inside regular text.
 *
 * Examples:
 *
 * "Call John on +61 412 345 678"
 *
 * becomes:
 *
 * "Call John on [PHONE REDACTED]"
 */
function redactString(text) {

  /*
   * General international phone-number detector.
   *
   * Examples it is intended to catch:
   *
   * +61 412 345 678
   * +1 415 555 2671
   * (02) 9876 5432
   * 0412 345 678
   * 415-555-2671
   *
   * We subsequently count digits to avoid replacing
   * short ordinary numbers.
   */

  const phoneCandidate =
    /(?:\+?\d[\d\s().-]{7,}\d)/g;

  return text.replace(phoneCandidate, match => {

    const digitCount =
      (match.match(/\d/g) || []).length;

    // Avoid treating short numbers as telephone numbers
    if (digitCount < 8 || digitCount > 15) {
      return match;
    }

    return "[PHONE REDACTED]";
  });
}


/**
 * JSON response helper
 */
function jsonResponse(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}
