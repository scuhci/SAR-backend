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
let emailMappings = {};

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

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
    },
});

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
                console.log("[%s] Main Title Fetched: %s\n", file_name, mainResult.title);
                const relatedQuery = `related to ${mainResult.title}`;
                try {
                    relatedResults.push(await search({ term: relatedQuery, country: country }));
                } catch {
                    console.error(`Unable to fetch app details for appID: ${mainResult.appId}`);
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
                }))
            ),
        ];

        console.log("[%s] [%d] allResults:\n-------------------------\n", file_name, allResults.length);
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
            })
        );

        // Filter out apps with missing details
        const validResults = detailedResults.filter((appInfo) => appInfo !== null);

        console.log("[%s] [%d] validResults:\n-------------------------\n", file_name, validResults.length);
        for (const result of validResults) {
            console.log("[%s] %s\n", file_name, result.title);
        }

        // Remove duplicates based on appId
        const uniqueResults = Array.from(new Set(validResults.map((appInfo) => appInfo.appId))).map((appId) => {
            return validResults.find((appInfo) => appInfo.appId === appId);
        });

        if (uniqueResults.length === 0) {
            throw new Error(`Search for '${query}' did not return any results.`);
        }

        // Calculate similarity score for all unique results
        globalQuery = query;
        const resultsWithSimilarityScore = uniqueResults.map(calculateResultSimilarityScore);

        console.log(
            "[%s] [%d] results shown on SMAR Website:\n-------------------------\n",
            file_name,
            resultsWithSimilarityScore.length
        );
        for (const result of resultsWithSimilarityScore) {
            console.log("[%s] Title: %s, Similarity Score: %d\n", file_name, result.title, result.similarityScore);
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
            const permissionsResults = await permissionsController.fetchPermissions(uniqueResults);

            // Process permissions data for the sliced 5 results
            const processedPermissionsResults = permissionsResults.map((appInfo) => {
                const permissionsWithSettings = standardPermissionsList.map((permission) => ({
                    permission: permission,
                    // type: permission.type,
                    isPermissionRequired: appInfo.permissions.some(
                        (appPermission) => appPermission.permission === permission
                    )
                        ? true
                        : false,
                }));

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
            csvData.length
        );
        for (const result of csvData) {
            console.log("[%s] %s\n", file_name, result.title);
        }
        // const pushQuery = "c:" + country + "_t:" + query + "_p:" + permissions + "_t:" + time; // new relog key since results are based on country + permissions + search query now
        const pushQuery = "c:" + country + "_t:" + query + "_p:" + permissions; // Remove time?

        console.log(pushQuery);
        // email the user that their request is done
        if (emailMappings[pushQuery] !== undefined) {
            // get the email associated with a query
            const userEmail = emailMappings[pushQuery];
            (async () => {
                try {
                    // generate the CSV to send back, similar to the downloadCSV option
                    const csv = jsonToCsv(csvData, "app", standardPermissionsList, permissions);

                    const timestamp = new Date().toLocaleString("en-US", {
                        month: "numeric",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "numeric",
                        hour12: true,
                    });

                    const dateComponents = timestamp.split("/").map((component) => component.trim());
                    const timeComponents = dateComponents[2].split(",").map((component) => component.trim());

                    const formattedTimestamp = `${dateComponents[0]}${dateComponents[1]}${timeComponents[0]}`;
                    const csvFilename = `${query}_${formattedTimestamp}.csv`;

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
                                  <p style="margin: 5px 0;"><strong>Search Query:</strong> ${query}</p>
                                  <p style="margin: 5px 0;"><strong>Country:</strong> ${country}</p>
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
                                      <strong>📎 Attachment:</strong> ${csvFilename}<br>
                                      This CSV file contains all the app data you requested and can be opened in Excel, Google Sheets, or any spreadsheet application.
                                  </p>
                              </div>
                          </div>
                          
                          <!-- CTA Button -->
                          <div style="text-align: center; margin: 30px 0;">
                              <a href="https://www.smar-tool.org" 
                                style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; padding: 15px 30px; border-radius: 25px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);">
                                  Visit SMAR Tool 🚀
                              </a>
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
                                      © ${new Date().getFullYear()} SMAR Team
                                  </span>
                              </div>
                          </div>
                      </div>
                  </div>
              </body>
              </html>`;

                    transporter.sendMail(
                        {
                            from: '"Jeshwin from the SMAR Team" <smar-tool@googlegroups.com>',
                            to: userEmail,
                            subject: "[SMAR Tool] Your App Store/Play Store Data is Ready!",
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
                            if (error) console.log("Error:", error);
                        }
                    );

                    // console.log("Email Sent");
                    delete emailMappings[pushQuery];
                } catch (e) {
                    console.log(e);
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
        return res.status(500).json({ error: "An error occurred while processing your request." });
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
            res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
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
            const csv = jsonToCsv(csvInfo, "app", standardPermissionsList, permissions);
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
            const dateComponents = timestamp.split("/").map((component) => component.trim());
            const timeComponents = dateComponents[2].split(",").map((component) => component.trim());

            // Format the timestamp without spaces
            const formattedTimestamp = `${dateComponents[0]}${dateComponents[1]}${timeComponents[0]}`;

            // Suggest a filename to the browser
            const suggestedFilename = `${query}_${formattedTimestamp}.csv`;
            res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

            res.setHeader("Content-Type", ["text/csv", "charset=utf-8"]);

            // Set response headers for CSV download
            res.setHeader("Content-Disposition", `attachment; filename="${encodeURI(suggestedFilename)}"`);

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
            console.log("Received request on /search/email endpoint", req.query);

            const queryId = req.query?.queryId;
            const email = req.query?.email;

            if (!queryId || !email)
                return res.status(400).json({
                    status: "error",
                    message: "uh oh, queryId or email wasn't processed right",
                });

            emailMappings[queryId] = email;
            res.status(200).json({ status: "success" });
            console.log("Email Mapping test: ", emailMappings[queryId]);
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
};
