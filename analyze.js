const core = require('@actions/core');
const glob = require('@actions/glob')
const _ = require('underscore')
const archiver = require('archiver')
const fs = require('fs')
const FormData = require('form-data')
const CodeDxApiClient = require('./codedx')
const path = require('path')

const getConfig = require('./config').get

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(), ms)
  });
};

const JobStatus = {
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed"
}

function Synchronously(fn) {
  return new Promise((resolve) => resolve(fn()))
}

function commaSeparated(str) {
  return (str || '').split(',').map(s => s.trim()).filter(s => s.length > 0)
}

function areGlobsValid(globsArray) {
  return !!globsArray && globsArray.length
}

function buildGlobObject(globsArray) {
  return glob.create(globsArray.join('\n'))
}

function prepareInputsZip(inputsGlob, targetFile) {
  return Synchronously(() => {
      const separatedInputGlobs = commaSeparated(inputsGlob);
      core.debug("Got input file globs: " + separatedInputGlobs)
      if (!areGlobsValid(separatedInputGlobs)) {
        throw new Error("No globs specified for source/binary input files")
      }
      return separatedInputGlobs  
    })
    .then((globs) => buildGlobObject(globs))
    .then(async (inputFilesGlob) => {
      const output = fs.createWriteStream(targetFile);
      const archive = archiver('zip');
      archive.on('end', () => console.log("Finished writing ZIP"))
      archive.on('warning', (err) => console.log("Warning: ", err))
      archive.on('error', (err) => console.log("Error: ", err))

      archive.pipe(output);

      let numWritten = 0
      for await (const file of inputFilesGlob.globGenerator()) {
        archive.file(file);
        numWritten += 1
      }
      await archive.finalize()
      return numWritten
    })
}

function attachInputsZip(inputGlobs, formData, tmpDir) {
  const zipTarget = path.join(tmpDir, "codedx-inputfiles.zip")
  return prepareInputsZip(inputGlobs, zipTarget)
    .then((numFiles) => Synchronously(() => {
      if (numFiles == 0) {
        throw new Error("No files were matched by the source/binary glob(s)")
      } else {
        core.info(`Added ${numFiles} files`)
      }

      formData.append('source-and-binaries.zip', fs.createReadStream(zipTarget))
    }))
}

function attachScanFiles(scanGlobs, formData) {
  const separatedScanGlobs = commaSeparated(scanGlobs)
  core.debug("Got scan file globs: " + separatedScanGlobs)

  if (areGlobsValid(separatedScanGlobs)) {
    return buildGlobObject(separatedScanGlobs)
      .then(async (scanFilesGlob) => {
        core.info("Searching with globs...")
        let numWritten = 0
        for await (const file of scanFilesGlob.globGenerator()) {
          numWritten += 1
          core.info('- Adding ' + file)
          const name = path.basename(file)
          formData.append(`${numWritten}-${name}`, fs.createReadStream(file))
        }
        core.info(`Found and added ${numWritten} scan files`)
      })
  } else {
    return Synchronously(() => core.info("(Scan files skipped as no globs were specified)"))
  }
}

function jumble(str) {
  var result = ''
  for (let i = 0; i < str.length; i++) {
    result += 'x'
    result += str[i]
  }
  return result
}

// most @actions toolkit packages have async methods
module.exports = async function run() {
  try {
    const config = getConfig();

    const client = new CodeDxApiClient(config.serverUrl, config.apiKey);
    await wait(1000);
    core.error("Are we sure this log is working at all??");
    await wait(1000);
    core.error("Using Code Dx URL: " + jumble(config.serverUrl));
    await wait(1000);
    core.error("Checking connection to Code Dx...");

    const codedxVersion = await client.testConnection();
    core.info("Confirmed - using Code Dx " + codedxVersion);

    core.info("Checking API key permissions...");
    await client.validatePermissions(config.projectId);
    core.info("Connection to Code Dx server is OK.");

    const formData = new FormData()
    
    core.info("Preparing source/binaries ZIP...")
    await attachInputsZip(config.inputGlobs, formData, config.tmpDir)

    core.info("Adding scan files...")
    await attachScanFiles(config.scanGlobs, formData)

    core.info("Uploading to Code Dx...")
    const { analysisId, jobId } = await client.runAnalysis(config.projectId, formData)

    core.info("Started analysis #" + analysisId)

    if (config.waitForCompletion) {
      core.info("Waiting for job to finish...")
      let lastStatus = null
      do {
        await wait(1000)
        try {
          lastStatus = await client.checkJobStatus(jobId)
        } catch (e) { throw e }
      } while (lastStatus != JobStatus.COMPLETED && lastStatus != JobStatus.FAILED)

      if (lastStatus == JobStatus.COMPLETED) {
        core.info("Analysis finished! Completed with status: " + lastStatus)
      } else {
        throw new Error("Analysis finished with non-complete status: " + lastStatus)
      }
    }
  } catch (ex) {
    throw ex
  }
}