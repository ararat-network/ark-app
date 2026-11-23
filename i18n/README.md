# i18n

The string resources, the locale formatting of amounts, dates, and currencies, and the check that every language
carries every string.

Nothing here is built yet. This README is the design the package follows, and each part is rewritten as what is
once it is built. The [repository's README](../README.md) says where the package sits among the others and the
order they are built in.

## Strings outside code

Every string a member reads is a resource from the first release, so a language is a translation, not a build
([languages](https://github.com/ararat-network/ark/blob/main/docs/direction/TOOLING_DIRECTION.md#languages)).

The string resources are not a build step of their own: every string is a resource from the first step.

## Decisions

| Decision                          | Options                                                                                                                      | Recommendation                                                                                                      | Blocks                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| The languages of the first release | Every language of the starting assets; the first cohort's languages, the rest as translations arrive                          | The first cohort's, with English complete and the pipeline proving a language is a resource                         | The string freeze before release; nothing in code                         |

## What it must not become

A second reading of a transaction: a translation renders the same decoded fields.
