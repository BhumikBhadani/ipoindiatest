import fs from "fs";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
dotenv.config();

puppeteer.use(StealthPlugin());

const baseUrl = "https://webnodejs.chittorgarh.com/cloud/report/data-read";
const version = "21-28"; // Change this if the version updates
const year = "2025";
const financialYear = "2024-25";

// Get the current month dynamically
const currentMonth = new Date().getMonth() + 1; // February = 2, March = 3, etc.

const urls = {
    "All IPOs": `${baseUrl}/82/1/${currentMonth}/${year}/${financialYear}/0/0?search=&v=${version}`,
    //"Mainline IPOs": `${baseUrl}/83/1/${currentMonth}/${year}/${financialYear}/0/0?search=&v=${version}`,
    //"SME IPOs": `${baseUrl}/84/1/${currentMonth}/${year}/${financialYear}/0/0?search=&v=${version}`
};

// Extract links with proper Issuer Company names
async function extractLinks() {
    let collectedLinks = [];

    for (const [tabName, url] of Object.entries(urls)) {
        console.log(`Fetching data from ${tabName} - ${url}...`);

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            const jsonData = await response.json();
            const reportTableData = jsonData.reportTableData;

            reportTableData.forEach(row => {
                if (row["Issuer Company"] && row["Issuer Company"].includes("href=")) {
                    const match = row["Issuer Company"].match(/href="([^"]+)"/);
                    if (match) {
                        let companyName = row["Issuer Company"].replace(/<[^>]+>/g, "").trim(); // Remove HTML tags
                        companyName = companyName.replace(/[\/:*?"<>|]/g, ""); // Remove invalid filename characters
                        collectedLinks.push({ url: match[1], name: companyName });
                    }
                }
            });

        } catch (error) {
            console.error(`Error fetching data from ${tabName}:`, error);
        }
    }

    if (collectedLinks.length > 0) {
        fs.writeFileSync("links.txt", collectedLinks.map(entry => `${entry.name}||${entry.url}`).join("\n"), "utf-8");
        console.log("Hyperlinks extracted and saved to links.txt!");
    } else {
        console.log("No hyperlinks found.");
    }

    return collectedLinks;
}

// Function to fetch and clean IPO content
async function fetchData(name, url) {
    try {
        console.log(`Fetching: ${url}`);

        const browser = await puppeteer.launch({
            headless: "new",
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled", "--ignore-certificate-errors", "--disable-web-security"]
        });

        const page = await browser.newPage();

        await page.setUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );
        await page.setExtraHTTPHeaders({
            "Referer": "https://www.google.com/",
            "Accept-Language": "en-US,en;q=0.9",
        });

        await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

        await page.waitForSelector("#main", { timeout: 30000 });

        // Extract and clean relevant content
        const extractedContent = await page.evaluate(() => {
            let sections = [];
            let stopExtracting = false;
            let currentSection = null;

            let elements = document.querySelectorAll("#main h1, #main h2, #main h3, #main h4, #main p, #main table, #main ul, #main ol");

            elements.forEach((el) => {
                if (stopExtracting) return;

                let textContent = el.innerText.trim();

                // Stop extracting if "IPO Prospectus" is found
                if (["H1", "H2", "H3", "H4"].includes(el.tagName) && textContent.includes("IPO Prospectus")) {
                    stopExtracting = true;
                    return;
                }

                if (["H1", "H2", "H3", "H4"].includes(el.tagName)) {
                    currentSection = {
                        title: textContent,
                        originalTag: el.tagName.toLowerCase(), // Store the original tag
                        content: []
                    };
                    sections.push(currentSection);
                } else if (currentSection) {
                    let cleanContent = el.cloneNode(true);

                    // Remove hyperlinks but keep the text
                    cleanContent.querySelectorAll("a").forEach(link => {
                        let text = link.innerText || link.textContent;
                        link.replaceWith(text);
                    });

                    // Remove unwanted <ul> with dropdown-menu class and docsDropdown label
                    if (el.tagName === "UL" && el.classList.contains("dropdown-menu") && el.getAttribute("aria-labelledby") === "docsDropdown") {
                        return;
                    }

                    if (el.tagName === "P") {
                        currentSection.content.push(`<p>${cleanContent.innerHTML.trim()}</p>`);
                    } else {
                        currentSection.content.push(cleanContent.outerHTML);
                    }
                }
            });

            // Extract and clean `.card` elements
            let allCards = [];
            let cards = document.querySelectorAll(".card");

            cards.forEach(card => {
                let cardHeader = card.querySelector(".card-header h2");
                let cardTitle = cardHeader ? cardHeader.innerText.trim() : "";

                // ✅ Remove card if <h2> contains "Lead Manager(s)", "Buy or Not" and "SME IPO Enquiry"
                if (cardTitle.includes("Lead Manager(s)") || cardTitle.includes("Buy or Not") || cardTitle.includes("SME IPO Enquiry")) {
                    return;
                }

                // ✅ Remove hyperlinks + text inside "Listing Details"
                if (cardTitle.includes("Listing Details")) {
                    card.querySelectorAll("a").forEach(link => {
                        link.remove();
                    });
                }

                // ✅ Remove only www.chittorgarh.com links in other cards
                card.querySelectorAll("a").forEach(link => {
                    if (link.href.includes("www.chittorgarh.com")) {
                        let text = link.innerText || link.textContent;
                        link.replaceWith(text);
                    }
                });

                allCards.push(card.outerHTML);
            });

            return { sections, allCards };
        });

        // console.log("Extracted sections:", extractedContent.sections.map(s => s.title));
        console.log("Extracted all .card elements with applied filters");

        let htmlContent = extractedContent.sections.map(section => {
            let headingTag = section.originalTag || "h2"; // Default to h2 if tag is missing
            return `<${headingTag}>${section.title}</${headingTag}>\n${section.content.join("\n")}`;
        }).join("\n\n");        

        let cardHtmlContent = extractedContent.allCards.join("\n\n");

        const folderPath = "public";
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath);
        }

        // Convert name to a safe filename format
        // const sanitizedFileName = name.split(" ")[0]; // Use only the first word
        const sanitizedFileName = name.replace(/\s+/g, ""); // Remove all spaces

        const fileName = `${folderPath}/${sanitizedFileName}.html`;
        if (htmlContent.trim() || cardHtmlContent.trim()) {
            fs.writeFileSync(fileName, htmlContent + "\n\n" + cardHtmlContent);
            console.log(`Extracted content saved to ${fileName}`);

            // Upload to Cloudflare R2
            const s3Client = new S3Client({
                region: "auto",
                endpoint: process.env.CLOUDFLARE_R2_ENDPOINT,
                credentials: {
                    accessKeyId: process.env.CLOUDFLARE_ACCESS_KEY_ID,
                    secretAccessKey: process.env.CLOUDFLARE_SECRET_ACCESS_KEY
                }
            });

            const bucketName = process.env.CLOUDFLARE_R2_BUCKET;
            const objectKey = `${sanitizedFileName}.html`;

            try {
                const fileBuffer = fs.readFileSync(fileName);
                const uploadParams = {
                    Bucket: bucketName,
                    Key: objectKey,
                    Body: fileBuffer,
                    ContentType: "text/html"
                };

                await s3Client.send(new PutObjectCommand(uploadParams));
                console.log(`File uploaded to Cloudflare R2: ${objectKey}`);
            } catch (uploadError) {
                console.error("Error uploading to Cloudflare R2:", uploadError);
            }
        } else {
            console.log("No relevant content found.");
        }

        await browser.close();
    } catch (error) {
        console.error(`Error processing ${url}:`, error);
    }
}

// Main Function
(async () => {
    const extractedLinks = await extractLinks();


    if (extractedLinks.length === 0) {
        console.log("No links found. Exiting...");
        return;
    }

    // Take only the first 10 links
    const top10Links = extractedLinks.slice(0, 100);

    for (const { name, url } of top10Links) {
        await fetchData(name, url);
    }

    console.log("Extraction completed for the first 100 links!");
})();