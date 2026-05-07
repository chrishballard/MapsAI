import { randomBytes } from "node:crypto";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import "dotenv/config";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const envPassword = process.env.SEED_ADMIN_PASSWORD;
  const password = envPassword ?? randomBytes(18).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: "Admin",
      passwordHash,
      role: "admin",
    },
  });

  if (envPassword) {
    console.log(`Seed complete: ${email} (password from SEED_ADMIN_PASSWORD)`);
  } else {
    console.log(`Seed complete: ${email}`);
    console.log(`Generated password: ${password}`);
    console.log("Save this — it is not stored anywhere else.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
