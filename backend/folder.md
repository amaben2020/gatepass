propel-ingestion-api/
├── src/
│ ├── config/ # Database connection setups (Postgres, Redis config)
│ ├── controllers/ # Express request & response handlers
│ ├── models/ # Database schema structures / data definitions
│ ├── repositories/ # Pure database operations (SQL queries, Redis pushes)
│ ├── services/ # Core business logic (Adapters, Mortgage math, Aggregations)
│ ├── routes/ # API Endpoint paths definitions
│ └── app.js # Express app initialization
├── tests/ # Unit and Integration tests
├── package.json
└── README.md

❌
src/
├── models/
│ ├── MarketListing.js
│ ├── InternalProperty.js
│ └── User.js
├── repositories/
│ ├── MarketRepository.js
│ ├── PropertyRepository.js
│ └── UserRepository.js
├── controllers/
│ └── ...

✅
src/
├── config/ # Global database/Redis connection setup (shared by all)
├── features/
│ ├── market-analytics/ # 🏡 EVERYTHING for the scraping/mortgage feature
│ │ ├── market.model.js
│ │ ├── market.repository.js
│ │ ├── market.service.js
│ │ ├── market.controller.js
│ │ ├── market.routes.js
│ │ └── adapters/ # Sub-folder for specific scrapers/adapters
│ │ ├── zoopla.adapter.js
│ │ └── rightmove.adapter.js
│ │
│ ├── internal-portfolio/ # 🔑 EVERYTHING for Propel's owned assets
│ │ ├── portfolio.model.js
│ │ ├── portfolio.repository.js
│ │ └── portfolio.service.js
│ │
│ └── users/ # 👤 EVERYTHING for User accounts
│ ├── user.model.js
│ ├── user.repository.js
│ └── user.controller.js
│
├── app.js # Express app entry point
└── server.js # Starts the HTTP server

✅ DISTRIBUTED SYSTEM
📁 propel-distributed/
│
├── 📁 market-analytics-service/ # 🏡 RUNS ON SERVER A
│ ├── src/
│ │ ├── config/database.js # 🗄️ PRIVATE DB: Only contains scraping/mortgage data
│ │ ├── config/rabbitmq.js # 📻 Connects to the message broker
│ │ ├── scrapers/ # Zoopla / Rightmove scraping engines
│ │ ├── analytics.controller.js
│ │ └── server.js # Express app listening on Port 4001
│ └── package.json
│
├── 📁 internal-portfolio-service/ # 🔑 RUNS ON SERVER B
│ ├── src/
│ │ ├── config/database.js # 🗄️ PRIVATE DB: Only contains asset/property records
│ │ ├── config/rabbitmq.js
│ │ ├── portfolio.service.js
│ │ └── server.js # Express app listening on Port 4002
│ └── package.json
│
├── 📁 users-service/ # 👤 RUNS ON SERVER C
│ ├── src/
│ │ ├── config/database.js # 🗄️ PRIVATE DB: Only contains user accounts/auth
│ │ ├── config/redis.js # ⚡ Shared distributed cache / Idempotency store
│ │ ├── user.controller.js
│ │ └── server.js # Express app listening on Port 4003
│ └── package.json
│
└── 📁 api-gateway/ # 🚧 RUNS ON SERVER D (The Entry Point)
├── src/
│ ├── middleware/idempotency.js # 🛡️ Global idempotency filter lives HERE now
│ └── server.js # Routes traffic to 4001, 4002, or 4003
└── package.json

✅
src/
├── config/ # Global database/Redis connection setup (shared by all)
│ ├── database.js # Postgres/SQL connection
│ └── redis.js # Redis connection (for temporary locks/keys)
│
├── middleware/ # Global Express middlewares
│ └── idempotency.js # 🛡️ THE IDEMPOTENCY MIDDLEWARE
│
├── features/
│ ├── market-analytics/ # 🏡 EVERYTHING for scraping/mortgage
│ │ └── ...
│ │
│ ├── internal-portfolio/ # 🔑 EVERYTHING for Propel's owned assets
│ │ └── ...
│ │
│ └── users/ # 👤 EVERYTHING for User accounts
│ ├── user.model.js
│ ├── user.repository.js
│ ├── user.controller.js
│ └── user.routes.js # 👈 Where you apply the middleware to specific routes
│
├── app.js # Express app configuration & global middleware routing
└── server.js # Starts the HTTP server

// src/app.js
import express from 'express';
import cors from 'cors';

// Import the routing entry points from our decoupled features
import marketAnalyticsRoutes from './features/market-analytics/market.routes.js';
// (You would import other features here, e.g., import portfolioRoutes from './features/...')

const app = express();

// Standard middleware setup
app.use(cors());
app.use(express.json());

// Register the features under clean, logical base paths
app.use('/api/market', marketAnalyticsRoutes);

// Global Error Handling Middleware
app.use((err, req, res, next) => {
console.error('🚨 Global Pipeline Error Context:', err.stack);
res.status(err.status || 500).json({
error: err.message || 'Internal Server Pipeline Error'
});
});

export default app;

// src/server.js
import app from './app.js';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
console.log(`🚀 Propel Core Pipeline API listening on port ${PORT}`);
});

// src/features/market-analytics/market.routes.js
import express from 'express';
import MarketController from './market.controller.js';

const router = express.Router();

// Maps cleanly to the controller methods
router.get('/threat-report', MarketController.getMarketReport);

export default router;

// src/features/market-analytics/market.service.spec.js
import { jest } from '@jest/globals';
import AnalyticsService from './market.service.js';
import MarketRepository from './market.repository.js';

// Mock the repository completely so we don't look at a live PostgreSQL instance
jest.mock('./market.repository.js');

describe('AnalyticsService - Ingestion & Market Analytics Logic', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should correctly calculate standard UK mortgage amortization and flag threat alerts', async () => {
        // 1. Arrange: Setup simulated data returning from Drizzle ORM layout
        const mockDbListings = [
            { id: 1, title: 'Test Flat', price: '300000', bedrooms: 3, outcode: 'B31', developer: 'Test Dev' }
        ];

        // Force the repository mock method to yield our layout array
        MarketRepository.findNewestByOutcode.mockResolvedValue(mockDbListings);

        const targetOutcode = 'B31';
        const targetBeds = 3;
        const propelBaselineRent = 2000; // Rent is higher than estimated mortgage payment

        // 2. Act: Execute the service method layer calculation
        const result = await AnalyticsService.generateMarketThreatReport(targetOutcode, targetBeds, propelBaselineRent);

        // 3. Assert: Verify the financial variance calculations match absolute truths
        expect(MarketRepository.findNewestByOutcode).toHaveBeenCalledWith(targetOutcode, targetBeds);
        expect(result.averageSalePrice).toBe(300000);

        // 10% deposit = £30k, Loan = £270k. At 4.5% over 25 years, monthly payment is roughly £1,501.
        expect(result.estimatedMonthlyMortgage).toBe(1501);

        // Since mortgage (£1501) < rent (£2000), it should flag an active risk alert
        expect(result.status).toContain('🚨 HIGH BUYING THREAT');
    });

    it('should gracefully handle empty database listings without crashing the server logic', async () => {
        // Arrange: Repository returns empty array (e.g. scraper didn't run yet)
        MarketRepository.findNewestByOutcode.mockResolvedValue([]);

        // Act
        const result = await AnalyticsService.generateMarketThreatReport('B31', 3, 1400);

        // Assert
        expect(result).toHaveProperty('error');
        expect(result.error).toContain('No active market listings found');
    });

});

Here is that exact summary reinforced into punchy bullets you can use to explain it cleanly in a technical interview:

db.js (Configuration): Establishes the physical database connection via pg.Pool and wraps it with Drizzle.

models (Schemas): The structural blueprint defining table fields, constraints, and data types.

repositories (Data Access): Pure database operations (select, insert, update). It only talks to Drizzle and does not care about the rest of the application.

services (Business Logic): Where the data makes sense. It calls repositories, runs the mortgage math, handles data transformation (adapters), and aggregates metrics.

controllers (HTTP Interface): The entry point logic handling req and res, validating request parameters, and sending back HTTP status codes.

Think of models like drizzle schemas.In Drizzle, models are defined as table schemas using plain TypeScript/JavaScript. Drizzle automatically generates the types for you.
// src/config/schema.js
import { pgTable, serial, varchar, integer, numeric, timestamp } from 'drizzle-orm/pg-core';

// 1. Define the Market Listings Schema (Scraped Data)
export const marketListings = pgTable('market_listings', {
id: serial('id').primaryKey(),
title: varchar('title', { length: 255 }).notNull(),
price: numeric('price').notNull(), // Stored as numeric string, parsed in adapter/service
bedrooms: integer('bedrooms').notNull(),
outcode: varchar('outcode', { length: 10 }).notNull(),
developer: varchar('developer', { length: 255 }).notNull(),
sourcePortal: varchar('source_portal', { length: 50 }).notNull(),
scrapedAt: timestamp('scraped_at').defaultNow().notNull(),
});

// 2. Define Propel's Portfolio Schema (Internal Data)
export const propelProperties = pgTable('propel_properties', {
id: serial('id').primaryKey(),
internalRef: varchar('internal_ref', { length: 50 }).notNull(),
postcode: varchar('postcode', { length: 10 }).notNull(),
currentRent: integer('current_rent').notNull(),
bedrooms: integer('bedrooms').notNull(),
});

db.js:
// src/config/db.js
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import \* as schema from './schema.js';

const pool = new pg.Pool({
connectionString: "postgresql://username:password@localhost:5432/propel_db",
});

export const db = drizzle(pool, { schema });

repositroy: The Repository uses Drizzle’s SQL query builder. Notice how clean it is—no raw SQL text strings are required, and the return objects match the schema automatically.

// src/repositories/MarketRepository.js
import { db } from '../config/db.js';
import { marketListings } from '../config/schema.js';
import { eq, and, sql } from 'drizzle-orm';

class MarketRepository {
// Fetches scraped items matching outcode, bedrooms, and scraped today
static async findNewestByOutcode(outcode, bedrooms) {
return await db.select()
.from(marketListings)
.where(
and(
eq(marketListings.outcode, outcode),
eq(marketListings.bedrooms, bedrooms),
// Check if scraped_at date is equal to today's date
sql`DATE(${marketListings.scrapedAt}) = CURRENT_DATE`
)
);
}
}
export default MarketRepository;

Service: The Service layer handles the business logic. It takes the output from Drizzle, converts the decimal/numeric fields from strings into numbers, and processes the mortgage calculations.

// src/services/AnalyticsService.js
import MarketRepository from '../repositories/MarketRepository.js';

class AnalyticsService {
static async generateMarketThreatReport(outcode, bedrooms, propelBaselineRent) {
// 1. Grab clean records out of the database using the Repository
const listings = await MarketRepository.findNewestByOutcode(outcode, bedrooms);

        if (listings.length === 0) {
            return { error: `No active market listings found for area ${outcode}` };
        }

        // 2. Process math aggregations (Drizzle returns numeric as strings to preserve precision)
        const totalVolume = listings.length;
        const totalSaleValue = listings.reduce((sum, item) => sum + parseFloat(item.price), 0);
        const averageMarketPrice = Math.round(totalSaleValue / totalVolume);

        // 3. Compute Mortgage Logic (10% deposit, 4.5% interest, 25 years)
        const loanAmount = averageMarketPrice * 0.90;
        const monthlyRate = 0.045 / 12;
        const totalMonths = 25 * 12;
        const estMonthlyMortgage = Math.round(
            loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, totalMonths)) / (Math.pow(1 + monthlyRate, totalMonths) - 1)
        );

        // 4. Determine market risk indicators for Propel
        const variance = estMonthlyMortgage - propelBaselineRent;
        const threatAlert = variance < 0 ? "🚨 HIGH BUYING THREAT (Buying is cheaper than renting)" : "✅ RENTAL DEMAND SECURE";

        return {
            outcode,
            propertyBeds: bedrooms,
            sampleSizeChecked: totalVolume,
            averageSalePrice: averageMarketPrice,
            estimatedMonthlyMortgage: estMonthlyMortgage,
            propelTargetRent: propelBaselineRent,
            financialSpread: variance,
            status: threatAlert
        };
    }

}
export default AnalyticsService;

4. The Controller Layer (/src/controllers/)The Controller unpacks the HTTP query strings safely and maps them right down to the Service layer engine.

// src/controllers/AnalyticsController.js
import AnalyticsService from '../services/AnalyticsService.js';

class AnalyticsController {
static async getMarketReport(req, res) {
try {
const { outcode, bedrooms, baselineRent } = req.query;

            // Enforce explicit parameter checks
            if (!outcode || !bedrooms || !baselineRent) {
                return res.status(400).json({ error: "Missing required query parameters: outcode, bedrooms, baselineRent" });
            }

            const report = await AnalyticsService.generateMarketThreatReport(
                outcode.toUpperCase(),
                parseInt(bedrooms, 10),
                parseFloat(baselineRent)
            );

            return res.status(200).json(report);
        } catch (error) {
            console.error("Controller Execution Error:", error);
            return res.status(500).json({ error: "Internal Server Analytics Error Triggered" });
        }
    }

}
export default AnalyticsController;
