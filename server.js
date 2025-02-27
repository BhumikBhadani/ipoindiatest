import express from "express";
import fs from "fs";
import { exec } from "child_process"; // Added child_process to execute the script

const app = express();
const PORT = process.env.PORT || 3000;

// Run extract_html.js when the server starts
exec("node extract_html.js", (error, stdout, stderr) => {
    if (error) {
        console.error(`Error executing extract_html.js: ${error.message}`);
        return;
    }
    if (stderr) {
        console.error(`extract_html.js stderr: ${stderr}`);
        return;
    }
    console.log(`extract_html.js output: ${stdout}`);
});

app.use(express.static("public"));

app.get("/", (req, res) => {
    res.send("Server is running!");
});

app.get("/scrape", async (req, res) => {
    try {
        console.log("Fetching data...");

        const baseUrl = "https://webnodejs.chittorgarh.com/cloud/report/data-read";
        const version = "21-28"; // Change this if the version updates
        const year = "2025";
        const financialYear = "2024-25";

        // Get the current month dynamically
        const currentMonth = new Date().getMonth() + 1; // February = 2, March = 3, etc.

        const urls = {
            "All IPOs": `${baseUrl}/82/1/${currentMonth}/${year}/${financialYear}/0/0?search=&v=${version}`,
            "Mainline IPOs": `${baseUrl}/83/1/${currentMonth}/${year}/${financialYear}/0/0?search=&v=${version}`,
            "SME IPOs": `${baseUrl}/84/1/${currentMonth}/${year}/${financialYear}/0/0?search=&v=${version}`
        };

        let tables = "";
        let tabButtons = "";
        let index = 0;

        for (const [tabName, url] of Object.entries(urls)) {
            console.log(`Fetching data from ${tabName} - ${url}...`);
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }

                const jsonData = await response.json();
                const reportTableData = jsonData.reportTableData;

                let tableRows = "";
                const today = new Date();

                reportTableData.forEach(row => {
                    let openDate = new Date(row["Open Date"]);
                    let closeDate = new Date(row["Close Date"]);
                    let listingDate = new Date(row["Listing Date"]);
                    let rowColor = "";

                    if (today >= openDate && today < closeDate) {
                        rowColor = "#c5ecc8"; // Green
                    } else if (today.toDateString() === closeDate.toDateString()) {
                        rowColor = "#E57373"; // Red
                    } else if (today > closeDate && today < listingDate) {
                        rowColor = "#ffffcc"; // Yellow
                    } else if (today.toDateString() === listingDate.toDateString()) {
                        rowColor = "#c1f9ff"; // Blue
                    }

                    tableRows += `
                        <tr style="background-color: ${rowColor}">
                            <td>
                                <a href="https://ipoindiaa.com/${row["Issuer Company"]
                                    .replace(/<a\b[^>]*>(.*?)<\/a>/gi, "$1")  // Remove anchor tags if present
                                    .replace(/\s+/g, "-")  // Replace spaces with hyphens
                                    .toLowerCase()}/"  
                                    target="_blank"  
                                    style="text-decoration: none; color: unset;">
                                    ${row["Issuer Company"].replace(/<a\b[^>]*>(.*?)<\/a>/gi, "$1")}
                                </a>
                            </td>
                            <td>${row["Open Date"]}</td>
                            <td>${row["Close Date"]}</td>
                            <td>${row["Listing Date"]}</td>
                            <td>${row["Issue Price (Rs)"] || "N/A"}</td>
                            <td>${row["Issue Size (Rs Cr.)"] || "N/A"}</td>
                            <td>${row["Lot Size"] || "N/A"}</td>
                            <td>${row["Exchange"]}</td>
                        </tr>`;
                });
                
                tables += `
                    <div id="tab${index}" class="tabcontent" style="display: ${index === 0 ? 'block' : 'none'};">
                        <table>
                            <thead>
                                <tr>
                                    <th>Issuer Company</th>
                                    <th>Open Date</th>
                                    <th>Close Date</th>
                                    <th>Listing Date</th>
                                    <th>Issue Price (Rs)</th>
                                    <th>Issue Size (Rs Cr.)</th>
                                    <th>Lot Size</th>
                                    <th>Exchange</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${tableRows}
                            </tbody>
                        </table>
                    </div>`;

                tabButtons += `
                    <li class="tab" role="presentation">
                        <a href="#tab${index}" role="tab" onclick="openTab(event, 'tab${index}')" class="tab-link ${index === 0 ? 'active' : ''}">
                            <span>${tabName}</span>
                        </a>
                    </li>`;
            } catch (fetchError) {
                console.error(`Error fetching data from ${tabName}:`, fetchError);
            }
            index++;
        }

        let htmlPage = `
            <html>
            <head>
                <title>IPO Data</title>
                <style>
                    body { font-family: Arial, sans-serif; }
                    .tabbed-head ul { list-style: none; padding: 0; display: flex; border-bottom: 2px solid #ddd; }
                    .tabbed-head li { margin-right: 10px; }
                    .tab-link { 
                        padding: 10px 15px; 
                        display: inline-block; 
                        text-decoration: none; 
                        color: black;
                        font-weight: normal;
                        position: relative;
                    }
                    .tab-link.active {
                        font-weight: bold;
                    }
                    .tab-link.active::after {
                        content: "";
                        display: block;
                        width: 100%;
                        height: 3px;
                        background: #002868;
                        position: absolute;
                        bottom: -2px;
                        left: 0;
                    }
                    .tabcontent { display: none; margin-top: 20px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                    th { background-color: #002868; color: white; }
                </style>
            </head>
            <body>
                <div class="tabbed-head">
                    <ul class="nav nav-tabs af-tabs tab-warpper" role="tablist">
                        ${tabButtons}
                    </ul>
                </div>
                ${tables}
                <script>
                    function openTab(event, tabId) {
                        event.preventDefault(); // Prevents the page from jumping
                        document.querySelectorAll(".tabcontent").forEach(tab => tab.style.display = "none");
                        document.getElementById(tabId).style.display = "block";
                        document.querySelectorAll(".tab-link").forEach(tab => tab.classList.remove("active"));
                        event.currentTarget.classList.add("active");
                    }
                </script>
            </body>
            </html>`;

        console.log("Scraping and table generation successful!");
        res.send(htmlPage);
    } catch (error) {
        console.error("Error scraping:", error);
        res.send(`<h2>Error occurred:</h2><p>${error.message}</p>`);
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
