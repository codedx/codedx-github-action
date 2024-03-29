# GitHub Action for SRM

This GitHub action can be used to push source code, binaries, and scan results to an [SRM](https://codedx.com) instance from within a GitHub workflow; source and binaries are automatically scanned by SRM using its built-in analysis tools.

## Features and Behavior

Comma-separated globs are used to select source/binary files and scan-result files. 

The Action can optionally wait for analysis completion, writing the final status of the analysis to logs.

The workflow will be set to fail if:

- The source/binaries glob(s) fail to match any files
- There are any errors when contacting your SRM server
- The analysis ends in failure

## Requirements

- A deployed, licensed instance of SRM (any license)
- Access from GitHub to SRM via HTTP, or via HTTPS with a recognizable certificate (use the `ca-cert` param if not using a public CA)
- A Project in SRM to store results
- An API Key or Personal Access Token with "Create" permissions for the Project

## Action Inputs

| Input Name                 | Description                                                                                              | Default Value | Required |
|----------------------------|----------------------------------------------------------------------------------------------------------|---------------|----------|
| `server-url`               | The URL for the SRM server (typically ends with `/codedx`)                                           |               | Yes      |
| `api-key`                  | An API Key or Personal Access Token to use when connecting to SRM                                    |               | Yes      |
| `project-id`               | The ID of a project (an integer) created in SRM                                                      |               | Yes      |
| `source-and-binaries-glob` | A comma-separated-list of file globs matching source and binary files to be packaged and sent to SRM | `undefined`   | No       |
| `tool-outputs-glob`        | A comma-separated list of file globs matching tool output/scan result files                              | `undefined`   | No       |
| `wait-for-completion`      | Whether to wait for the analysis to complete before exiting                                              | `false`       | No       |
| `ca-cert`                  | A custom CA cert to use for HTTPS connections to SRM                                                 | `undefined`   | No       |
| `dry-run`                  | Whether to submit an analysis (false/undefined) or only test the connection and credentials (true)       | `undefined`   | No       |

## Sample Workflow

```yaml
on: [push]

jobs:
  codedx-analyze:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v2
      - name: SRM Upload
        uses: 'codedx/codedx-github-action@v1.1'
        with:
          server-url: ${{ secrets.CDX_SERVER_URL }}
          api-key: ${{ secrets.CDX_API_KEY }}
          project-id: ${{ secrets.CDX_PROJECT_ID }}
          source-and-binaries-glob: './**'
          wait-for-completion: false
```