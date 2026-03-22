#!/usr/bin/env tsx
/**
 * Apply a NanoClaw skill by merging its changes into the codebase.
 * Usage: npx tsx scripts/apply-skill.ts <skill-path>
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const skillPath = process.argv[2];

if (!skillPath) {
  console.error('Usage: npx tsx scripts/apply-skill.ts <skill-path>');
  console.error('Example: npx tsx scripts/apply-skill.ts .claude/skills/add-matrix');
  process.exit(1);
}

const absolutePath = path.resolve(skillPath);

if (!fs.existsSync(absolutePath)) {
  console.error(`Skill path not found: ${absolutePath}`);
  process.exit(1);
}

const skillName = path.basename(absolutePath);
console.log(`Applying skill: ${skillName}`);

// Check for SKILL.md
type SkillMeta = {
  name?: string;
  description?: string;
  type?: 'feature' | 'utility' | 'operational' | 'container';
};

const skillMdPath = path.join(absolutePath, 'SKILL.md');
let skillMeta: SkillMeta = {};

if (fs.existsSync(skillMdPath)) {
  const skillContent = fs.readFileSync(skillMdPath, 'utf-8');
  // Parse frontmatter
  const frontmatterMatch = skillContent.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    frontmatter.split('\n').forEach((line) => {
      const [key, ...valueParts] = line.split(':');
      if (key && valueParts.length) {
        const value = valueParts.join(':').trim();
        (skillMeta as Record<string, string>)[key.trim()] = value;
      }
    });
  }
  console.log(`  Name: ${skillMeta.name || skillName}`);
  console.log(`  Description: ${skillMeta.description || 'N/A'}`);
}

// Handle different skill types
if (skillName === 'add-matrix') {
  // Matrix skill: files are already in place, just run setup
  console.log('\nMatrix skill files are already in place:');
  console.log('  - src/channels/matrix.ts');
  console.log('  - src/channels/matrix.test.ts');
  console.log('  - src/channels/index.ts (updated)');
  console.log('  - package.json (matrix-js-sdk added)');

  // Install dependencies if needed
  console.log('\nInstalling dependencies...');
  execSync('npm install', { stdio: 'inherit' });

  console.log('\nBuilding...');
  execSync('npm run build', { stdio: 'inherit' });

  console.log('\nRunning tests...');
  execSync('npm run test -- --run src/channels/matrix.test.ts', { stdio: 'inherit' });

  console.log('\n✓ Matrix skill applied successfully!');
  console.log('\nNext steps:');
  console.log('1. Set MATRIX_HOMESERVER_URL and MATRIX_ACCESS_TOKEN in .env');
  console.log('2. Run: npm run build');
  console.log('3. Restart the service');
  console.log('4. Register your Matrix room');
} else if (skillName.startsWith('add-')) {
  console.log('\nChannel skills typically merge from external git repos.');
  console.log('For add-matrix, files are already in place.');
} else {
  console.log(`\nUnknown skill type. Manual review needed for: ${skillName}`);
  console.log(`Files in skill directory:`);
  const files = fs.readdirSync(absolutePath, { recursive: true });
  files.forEach((f) => {
    const fullPath = path.join(absolutePath, f as string);
    if (fs.statSync(fullPath).isFile()) {
      console.log(`  - ${f}`);
    }
  });
}
