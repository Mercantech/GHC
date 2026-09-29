import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.teacherAllowlist.upsert({
    where: { githubLogin: "MAGS-GH" },
    create: {
      name: "Mathias Gaardsdal Steenberg",
      githubLogin: "MAGS-GH",
    },
    update: {
      name: "Mathias Gaardsdal Steenberg",
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
