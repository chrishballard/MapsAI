import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import "dotenv/config";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const passwordHash = await bcrypt.hash("mapsai2026", 10);

  await prisma.user.upsert({
    where: { email: "admin@vineyardgrowth.com" },
    update: {},
    create: {
      email: "admin@vineyardgrowth.com",
      name: "Admin",
      passwordHash,
      role: "admin",
    },
  });

  console.log("Seed complete: admin@vineyardgrowth.com / mapsai2026");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
