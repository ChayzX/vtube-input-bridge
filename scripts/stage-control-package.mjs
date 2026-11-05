import {mkdir, copyFile, readFile, writeFile, readdir, stat, rename, rm} from 'node:fs/promises';
import {join, relative} from 'node:path';
import {createHash} from 'node:crypto';

// Consumes the packager output; the versioned bundle is its only remaining consumer.
export async function stageControlPackage(root, app, version) {
  async function files(dir) {
    const result = [];
    for (const name of await readdir(dir)) {
      const path = join(dir, name);
      if ((await stat(path)).isDirectory()) result.push(...await files(path));
      else result.push({path: relative(app, path).replaceAll('\\', '/'), sha256: createHash('sha256').update(await readFile(path)).digest('hex')});
    }
    return result;
  }
  const manifest = await files(app);
  // One role-neutral package for both PCs, with the same scripts and manifest as before.
  const scripts = ['Install-Control.ps1', 'Rollback-Control.ps1', 'Control-RollbackCore.ps1', 'Set-BridgeFirewall.ps1', 'Uninstall-VTubeInputBridge.ps1', 'Migrate-StreamPCRelay.ps1', 'Restore-StreamPCRelay.ps1'];
  // New-ControlInstaller.ps1 expects exactly one versioned ZIP.
  for (const name of await readdir(join(root, 'build'))) {
    if (/^VTubeControl-(pantry-|canada-|\d)/.test(name)) await rm(join(root, 'build', name), {recursive: true, force: true});
  }
  const packageDir = join(root, 'build', `VTubeControl-${version}`);
  await mkdir(packageDir, {recursive: false});
  // Both directories are under build: rename avoids a second unpacked Electron runtime.
  await rename(app, join(packageDir, 'app'));
  for (const file of scripts) await copyFile(join(root, 'scripts', file), join(packageDir, file));
  await copyFile(join(root, 'docs/Control-Setup.md'), join(packageDir, 'SETUP.md'));
  await copyFile(join(root, 'docs/Control-Build-Status.md'), join(packageDir, 'BUILD-STATUS.md'));
  await writeFile(join(packageDir, 'bundle.json'), JSON.stringify({version, roles: ['pantry', 'canada'], files: manifest}, null, 2));
  return packageDir;
}
