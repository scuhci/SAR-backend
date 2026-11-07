require("dotenv").config();
const { google } = require("googleapis");
const natural = require("natural");
const { search, app } = require("google-play-scraper");
const { cleanText, jsonToCsv } = require("../utilities/jsonToCsv");
const permissionsController = require("./permissionsController");
const standardPermissionsList = require("./permissionsConfig");
const json_raw = require("../package.json");
const nodeTTL = require("node-ttl");
const nodemailer = require("nodemailer");
var node_ttl = new nodeTTL();

const path = require("path");
const file_name = path.basename(__filename);
const cors = require("cors");
const { globalAgent } = require("node:https");
const router = require("../routes/searchRoutes");

let csvData;
let globalQuery;

// --- "Notify me" registrations -------------------------------------------
// POST /email lets anyone ask the lab mailbox to send search results to an
// address, so it is bounded on every axis. These numbers are starting points,
// not tuned against real traffic; adjust them if legitimate users hit them.
const NOTIFY_TTL_MS = 24 * 60 * 60 * 1000; // registrations expire after a day
const NOTIFY_MAX_RECIPIENTS_PER_QUERY = 3;
const NOTIFY_MAX_PENDING_QUERIES = 500;
const NOTIFY_RATE_WINDOW_MS = 60 * 60 * 1000;
const NOTIFY_RATE_MAX_PER_IP = 10; // registrations per client IP per window
const NOTIFY_SWEEP_INTERVAL_MS = 60 * 1000;
const MAX_EMAIL_LENGTH = 254;
const MAX_QUERY_ID_LENGTH = 300;
// Dot-atom local part (RFC 5322 atext, so first+tag@uni.edu and o'brien@x.ie
// pass) and a hostname with a TLD. No quotes, spaces, commas or angle
// brackets, so one value can only ever be one recipient.
const ATEXT = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+";
const LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?";
const EMAIL_REGEX = new RegExp(
  `^${ATEXT}(?:\\.${ATEXT})*@(?:${LABEL}\\.)+[A-Za-z]{2,}$`,
);
// Same shape the search endpoint builds: c:<country>_t:<query>_p:<bool>
const QUERY_ID_REGEX = /^c:[A-Za-z]{2}_t:[\s\S]+_p:(?:true|false)$/;

// queryId -> { emails: string[], expiresAt: ms }
const emailMappings = new Map();
// client IP -> { count, resetAt: ms }
const notifyHitsByIp = new Map();
let lastNotifySweep = 0;

// Drop expired entries from both tables. Runs at most once a minute, so the
// per-IP table cannot grow beyond the IPs seen in the last window.
function sweepNotifyTables(now, force = false) {
  if (!force && now - lastNotifySweep < NOTIFY_SWEEP_INTERVAL_MS) return;
  lastNotifySweep = now;
  for (const [key, entry] of emailMappings)
    if (entry.expiresAt <= now) emailMappings.delete(key);
  for (const [ip, entry] of notifyHitsByIp)
    if (entry.resetAt <= now) notifyHitsByIp.delete(ip);
}

function isNotifyRateLimited(ip, now) {
  const key = String(ip || "unknown");
  const entry = notifyHitsByIp.get(key);
  if (!entry || entry.resetAt <= now) {
    notifyHitsByIp.set(key, { count: 1, resetAt: now + NOTIFY_RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > NOTIFY_RATE_MAX_PER_IP;
}

function isValidEmail(email) {
  return (
    typeof email === "string" &&
    email.length <= MAX_EMAIL_LENGTH &&
    email.indexOf("@") <= 64 &&
    EMAIL_REGEX.test(email)
  );
}

// Escape a value before interpolating it into the notification HTML.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Reduce a search term to something safe for an attachment filename: letters
// and digits in any script, plus . _ -
function safeFilenamePart(value) {
  const cleaned = String(value)
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 100);
  return cleaned || "search";
}

// Calculate similarity
function calculateJaccardSimilarity(set1, set2) {
  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  const similarity = intersection.size / union.size;
  return similarity;
}

// Calculate similarity score for search results
function calculateSimilarityScore(query, result) {
  const tokenizer = new natural.WordTokenizer();
  const queryTokens = new Set(tokenizer.tokenize(query.toLowerCase()));
  const resultTokens = new Set(tokenizer.tokenize(result.toLowerCase()));
  const similarity = calculateJaccardSimilarity(queryTokens, resultTokens);
  return similarity;
}

// Calculate similarity score and add it to the result object
function calculateResultSimilarityScore(result) {
  result.similarityScore = calculateSimilarityScore(globalQuery, result.title);
  return result;
}

const searchController = async (req, res) => {
  const query = req.query.query;
  const permissions = req.query.includePermissions === "true";
  const country = req.query.countryCode;
  console.log("[%s] Query Passed: %s\n", file_name, query);
  console.log("[%s] Country Code Passed: %s\n", file_name, country);

  res.set("Access-Control-Allow-Origin", "*");

  if (!query) {
    console.error("Missing search query");
    return res.status(400).json({ error: "Search query is missing.\n" });
  }
  try {
    const mainResults = await search({ term: query, country: country });
    const relatedResults = [];
    // if an appID is passed as the query
    try {
      const fetched_appID = await app({ appId: query, country: country }); // checking if our query is a valid app ID
      console.log("App ID passed\n");
      mainResults.splice(0, mainResults.length, fetched_appID);
    } catch (error) {
      // Secondary search for each primary result if required
      console.log("App ID not passed\n");
      for (const mainResult of mainResults) {
        console.log(
          "[%s] Main Title Fetched: %s\n",
          file_name,
          mainResult.title,
        );
        const relatedQuery = `related to ${mainResult.title}`;
        try {
          relatedResults.push(
            await search({ term: relatedQuery, country: country }),
          );
        } catch {
          console.error(
            `Unable to fetch app details for appID: ${mainResult.appId}`,
          );
        }
        // Introduce a delay between requests (e.g., 1 second)
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
    // Combine the main and secondary results
    const allResults = [
      ...mainResults.map((result) => ({
        ...result,
        country: country,
        source: "primary search",
      })),
      ...relatedResults.flatMap((results) =>
        results.map((result) => ({
          ...result,
          country: country,
          source: "related app",
        })),
      ),
    ];

    console.log(
      "[%s] [%d] allResults:\n-------------------------\n",
      file_name,
      allResults.length,
    );
    for (const result of allResults) {
      console.log("[%s] %s\n", file_name, result.title);
    }
    console.log("All results fetched\n");
    // Fetch additional details (including genre) for each result
    const detailedResults = await Promise.all(
      allResults.map(async (appInfo) => {
        try {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const appDetails = await app({
            appId: appInfo.appId,
            country: country,
          });
          return { ...appInfo, ...appDetails };
        } catch (error) {
          console.error("Error fetching app details:", error);
          return null;
        }
      }),
    );

    // Filter out apps with missing details
    const validResults = detailedResults.filter((appInfo) => appInfo !== null);

    console.log(
      "[%s] [%d] validResults:\n-------------------------\n",
      file_name,
      validResults.length,
    );
    for (const result of validResults) {
      console.log("[%s] %s\n", file_name, result.title);
    }

    // Remove duplicates based on appId
    const uniqueResults = Array.from(
      new Set(validResults.map((appInfo) => appInfo.appId)),
    ).map((appId) => {
      return validResults.find((appInfo) => appInfo.appId === appId);
    });

    if (uniqueResults.length === 0) {
      throw new Error(`Search for '${query}' did not return any results.`);
    }

    // Calculate similarity score for all unique results
    globalQuery = query;
    const resultsWithSimilarityScore = uniqueResults.map(
      calculateResultSimilarityScore,
    );

    console.log(
      "[%s] [%d] results shown on SMAR Website:\n-------------------------\n",
      file_name,
      resultsWithSimilarityScore.length,
    );
    for (const result of resultsWithSimilarityScore) {
      console.log(
        "[%s] Title: %s, Similarity Score: %d\n",
        file_name,
        result.title,
        result.similarityScore,
      );
    }

    if (resultsWithSimilarityScore.length === 0) {
      throw new Error(`Search for '${query}' did not return any results.`);
    }

    // Apply cleanText to the summary and recentChanges properties of each result
    const cleanedLimitedResults = resultsWithSimilarityScore.map((result) => {
      // Clean the summary column
      if (result.summary) {
        result.summary = cleanText(result.summary);
      }

      // Clean the recentChanges column
      if (result.recentChanges) {
        result.recentChanges = cleanText(result.recentChanges);
      }

      return result;
    });

    // Check if includePermissions is true
    if (permissions) {
      // If includePermissions is true, call the fetchPermissions function
      console.log("Calling fetchPermissions method");
      const permissionsResults =
        await permissionsController.fetchPermissions(uniqueResults);

      // Process permissions data for the sliced 5 results
      const processedPermissionsResults = permissionsResults.map((appInfo) => {
        const permissionsWithSettings = standardPermissionsList.map(
          (permission) => ({
            permission: permission,
            // type: permission.type,
            isPermissionRequired: appInfo.permissions.some(
              (appPermission) => appPermission.permission === permission,
            )
              ? true
              : false,
          }),
        );

        // Return appInfo with permissions
        return { ...appInfo, permissions: permissionsWithSettings };
      });

      resultsToSend = processedPermissionsResults;
      csvData = permissionsResults;
    } else {
      resultsToSend = cleanedLimitedResults;
      csvData = uniqueResults;
    }

    console.log(
      "[%s] [%d] entries to be forwarded to CSV:\n-------------------------\n",
      file_name,
      csvData.length,
    );
    for (const result of csvData) {
      console.log("[%s] %s\n", file_name, result.title);
    }
    // const pushQuery = "c:" + country + "_t:" + query + "_p:" + permissions + "_t:" + time; // new relog key since results are based on country + permissions + search query now
    const pushQuery = "c:" + country + "_t:" + query + "_p:" + permissions; // Remove time?

    console.log(pushQuery);
    // email the user that their request is done
    const notifyEntry = emailMappings.get(pushQuery);
    if (notifyEntry && notifyEntry.expiresAt <= Date.now())
      emailMappings.delete(pushQuery);
    else if (notifyEntry && notifyEntry.emails.length > 0) {
      // get the email associated with a query
      const userEmails = notifyEntry.emails;
      (async () => {
        try {
          const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
              user: process.env.GMAIL_USER,
              pass: process.env.GMAIL_PASS,
            },
          });

          // generate the CSV to send back, similar to the downloadCSV option
          const csv = jsonToCsv(
            csvData,
            "app",
            standardPermissionsList,
            permissions,
          );

          const timestamp = new Date().toLocaleString("en-US", {
            month: "numeric",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "numeric",
            hour12: true,
          });

          const dateComponents = timestamp
            .split("/")
            .map((component) => component.trim());
          const timeComponents = dateComponents[2]
            .split(",")
            .map((component) => component.trim());

          const formattedTimestamp = `${dateComponents[0]}${dateComponents[1]}${timeComponents[0]}`;
          const csvFilename = `${safeFilenamePart(query)}_${formattedTimestamp}.csv`;

          const htmlContent = `
              <!DOCTYPE html>
              <html lang="en">
              <head>
                  <meta charset="UTF-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <title>SMAR Tool - Data Ready</title>
              </head>
              <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
                  <div style="max-width: 600px; margin: 0 auto; background-color: white; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                      <!-- Header -->
                      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px 20px; text-align: center;">
                          <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 300;">
                              📱 SMAR Tool
                          </h1>
                          <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px;">
                              Your Results are Ready!
                          </p>
                      </div>
                      
                      <!-- Content -->
                      <div style="padding: 40px 30px;">
                          <div style="text-align: center; margin-bottom: 30px;">
                              <h2 style="color: #333; margin: 0; font-size: 24px; font-weight: 600;">
                                  Your data is ready to download!
                              </h2>
                          </div>
                          
                          <div style="background-color: #f8f9fa; border-radius: 8px; padding: 25px; margin-bottom: 30px;">
                              <h3 style="color: #333; margin: 0 0 15px 0; font-size: 18px;">Query Details:</h3>
                              <div style="color: #666; line-height: 1.6;">
                                  <p style="margin: 5px 0;"><strong>Search Query:</strong> ${escapeHtml(query)}</p>
                                  <p style="margin: 5px 0;"><strong>Country:</strong> ${escapeHtml(country)}</p>
                                  <p style="margin: 5px 0;"><strong>Include Permissions:</strong> ${
                                    permissions ? "Yes" : "No"
                                  }</p>
                                  <p style="margin: 5px 0;"><strong>Results Found:</strong> ${csvData.length} apps</p>
                              </div>
                          </div>
                          
                          <div style="text-align: center; margin-bottom: 30px;">
                              <p style="color: #666; font-size: 16px; line-height: 1.6; margin-bottom: 25px;">
                                  Thank you for using the SMAR Tool! 
                                  The results are attached to this email as a CSV file.
                              </p>
                              
                              <div style="background-color: #e3f2fd; border-left: 4px solid #2196f3; padding: 15px; margin: 20px 0; text-align: left;">
                                  <p style="margin: 0; color: #1976d2; font-size: 14px;">
                                      <strong>📎 Attachment:</strong> ${escapeHtml(csvFilename)}<br>
                                      This CSV file contains all the app data you requested and can be opened in Excel, Google Sheets, or any spreadsheet application.
                                  </p>
                              </div>
                          </div>
                      </div>
                      
                      <!-- Footer -->
                      <div style="background-color: #f8f9fa; padding: 25px 30px; border-top: 1px solid #e9ecef;">
                          <div style="text-align: center;">
                              <p style="color: #999; font-size: 12px; margin: 0; line-height: 1.5;">
                                  This search was performed using the SMAR tool. For questions or support, 
                                  visit <a href="https://www.smar-tool.org" style="color: #667eea;">www.smar-tool.org</a>
                              </p>
                              <div style="margin-top: 15px;">
                                  <span style="color: #ccc; font-size: 12px;">
                                      © ${new Date().getFullYear()} The HCI Lab at SCU
                                  </span>
                              </div>
                          </div>
                      </div>
                  </div>
              </body>
              </html>`;
          for (const userEmail of userEmails) {
            try {
              transporter.sendMail(
                {
                  from: '"Jeshwin from the SMAR Team" <smar-tool@googlegroups.com>',
                  to: userEmail,
                  subject:
                    "[SMAR Tool] Your App Store/Play Store Data is Ready!",
                  text: "👋Hello! Your CSV Is ready, thank you for using the SMAR tool!",
                  html: htmlContent,
                  attachments: [
                    {
                      filename: csvFilename,
                      content: csv,
                      contentType: "text/csv",
                    },
                  ],
                },
                (error) => {
                  // The error text can include the recipient; log the code only.
                  if (error)
                    console.log(
                      "Email Error:",
                      error.code || "unknown",
                      error.responseCode || "",
                    );
                },
              );
            } catch (e) {
              console.log("Error sending an email: ", e && e.code);
            }
          }
          console.log("Email Sent");
          emailMappings.delete(pushQuery);
        } catch (e) {
          console.log("Error sending emails: ", e);
        }
      })();
    }

    node_ttl.push(pushQuery, csvData, null, 604800); // 1 week
    console.log("CSV stored on backend");
    return res.json({
      totalCount: uniqueResults.length,
      results: resultsToSend,
    });
  } catch (error) {
    console.error("Error occurred during search:", error);
    return res
      .status(500)
      .json({ error: "An error occurred while processing your request." });
  }
};

const downloadRelog = (req, res) => {
  // creating a log file
  // SMAR Version Number, Time/Date, Search Term, # Apps Scraped, Options Selected,
  // Info text, Reviews Log?
  cors()(req, res, () => {
    try {
      const logInfo = {
        version: json_raw.version,
        date_time: new Date(),
        store: "Google Play Store",
        country: req.query.countryCode,
        search_query: req.query.query,
        num_results: req.query.totalCount,
        permissions: req.query.includePermissions,
        info: "This search was performed using the SMAR tool: www.smar-tool.org. This reproducibility log can be used in the supplemental materials of a publication to allow other researchers to reproduce the searches made to gather these results.",
      };
      // Implement store and country when applicable
      // Also, add additional options when applicable
      const logInfo_arr = Object.entries(logInfo);
      for (var i = 0; i < logInfo_arr.length; i++) {
        logInfo_arr[i] = logInfo_arr[i].join(": ");
      }
      const fileText = logInfo_arr.join("\n");
      console.log(fileText);
      const filename = "Reproducibility_Log_" + logInfo["query"];
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.setHeader("Content-Type", "text/plain");
      res.send(fileText);
    } catch (error) {
      console.error("Error generating relog file:", error);
      res.status(500).send("An error occurred while generating the relog.");
    }
  });
};

const downloadCSV = (req, res) => {
  // Use cors middleware for downloadCSV route
  cors()(req, res, () => {
    if (!csvData) {
      return res.status(404).json({ error: "CSV data not available." });
    }

    try {
      // Use the existing jsonToCsv method to convert JSON to CSV
      const query = req.query.query;
      const permissions = req.query.includePermissions === "true";
      const country = req.query.countryCode;
      const pushQuery = "c:" + country + "_t:" + query + "_p:" + permissions; // to retrieve the csv information from node_ttl
      console.log("pushQuery used for CSV: %s\n", pushQuery);
      var csvInfo = node_ttl.get(pushQuery); // now that we're separating searches by country, we want to make sure users get the CSV response from the country they searched for
      const csv = jsonToCsv(
        csvInfo,
        "app",
        standardPermissionsList,
        permissions,
      );
      // Get the current timestamp in the desired format
      const timestamp = new Date().toLocaleString("en-US", {
        month: "numeric",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "numeric",
        hour12: true,
      });

      // Extract date and time components and remove spaces
      const dateComponents = timestamp
        .split("/")
        .map((component) => component.trim());
      const timeComponents = dateComponents[2]
        .split(",")
        .map((component) => component.trim());

      // Format the timestamp without spaces
      const formattedTimestamp = `${dateComponents[0]}${dateComponents[1]}${timeComponents[0]}`;

      // Suggest a filename to the browser
      const suggestedFilename = `${query}_${formattedTimestamp}.csv`;
      res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

      res.setHeader("Content-Type", ["text/csv", "charset=utf-8"]);

      // Set response headers for CSV download
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURI(suggestedFilename)}"`,
      );

      // Send the CSV data as a response
      res.status(200).send(csv);
    } catch (error) {
      console.error("Error generating CSV:", error);
      res.status(500).send("An error occurred while generating the CSV.");
    }
  });
};

const addEmailNotification = (req, res) => {
  cors()(req, res, () => {
    try {
      // The address belongs in the JSON body, not the URL (where it ends up in
      // access logs and browser history). The query string is still read as a
      // fallback so a frontend that has not been updated keeps working; drop
      // it once the frontend only sends the body. Never log the address.
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const queryId = body.queryId ?? req.query?.queryId;
      const email = body.email ?? req.query?.email;
      console.log("Received request on /email endpoint");

      if (!queryId || !email)
        return res.status(400).json({
          status: "error",
          message: "uh oh, queryId or email wasn't processed right",
        });

      if (!isValidEmail(email))
        return res.status(400).json({
          status: "error",
          message: "Please enter a valid email address.",
        });

      if (
        typeof queryId !== "string" ||
        queryId.length > MAX_QUERY_ID_LENGTH ||
        !QUERY_ID_REGEX.test(queryId)
      )
        return res.status(400).json({
          status: "error",
          message: "Unrecognized query id.",
        });

      const now = Date.now();
      sweepNotifyTables(now);

      if (isNotifyRateLimited(req.ip, now))
        return res.status(429).json({
          status: "error",
          message: "Too many notification requests, please try again later.",
        });

      let entry = emailMappings.get(queryId);
      if (entry && entry.expiresAt <= now) {
        emailMappings.delete(queryId);
        entry = undefined;
      }
      if (!entry) {
        if (emailMappings.size >= NOTIFY_MAX_PENDING_QUERIES)
          sweepNotifyTables(now, true);
        if (emailMappings.size >= NOTIFY_MAX_PENDING_QUERIES)
          return res.status(429).json({
            status: "error",
            message: "Too many pending notifications, please try again later.",
          });
        entry = { emails: [], expiresAt: now + NOTIFY_TTL_MS };
        emailMappings.set(queryId, entry);
      }

      // Avoid duplicates; mailboxes are case-insensitive in practice, so
      // Victim@x and VICTIM@x count as one recipient.
      const lower = email.toLowerCase();
      if (!entry.emails.some((e) => e.toLowerCase() === lower)) {
        if (entry.emails.length >= NOTIFY_MAX_RECIPIENTS_PER_QUERY)
          return res.status(429).json({
            status: "error",
            message: "Too many recipients registered for this search.",
          });
        entry.emails.push(email);
      }

      res.status(200).json({ status: "success" });
      // console.log("Email Mapping test: ", emailMappings[queryId]);
    } catch (e) {
      console.log("Failed to add email", e);
      res.status(500).json({ status: "error", message: e });
    }
  });
};

module.exports = {
  search: searchController,
  downloadCSV,
  downloadRelog,
  addEmailNotification,
  // For the test suite only; not used by any route.
  _notifyInternals: { emailMappings, notifyHitsByIp },
};
