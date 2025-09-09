# pt-ki.github.io

This repository contains the source for the pt-ki GitHub Pages site.

## Development

Install Ruby dependencies and run the site locally:

```bash
bundle install
bundle exec jekyll serve
```

## Pre-commit hooks

Install and run pre-commit to lint and test the site before committing.
The hooks will run common checks, build the site, and verify the
generated HTML with [html-proofer](https://github.com/gjtorikian/html-proofer):

```bash
pip install pre-commit
pre-commit install
pre-commit run --all-files
```
