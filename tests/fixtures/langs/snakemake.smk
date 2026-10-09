include: "rules/common.smk"
def helper(wildcards):
    return str(wildcards)
rule all:
    input: helper
rule build:
    shell: "make"
