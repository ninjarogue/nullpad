//// The architecture rules in CLAUDE.md, as a check over the source text.
//// Gleam files are parsed with glance, so imports, calls and string literals
//// are the real ones. JavaScript files are read line by line.

import glance
import gleam/dict.{type Dict}
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/regexp.{type Regexp}
import gleam/result
import gleam/set.{type Set}
import gleam/string

const core = ["buffer", "vim", "editor", "live", "markdown", "library"]

const core_may_also_import = [#("library", "storage")]

const drawing = ["app", "surface", "preview", "platform"]

const may_call_javascript = [
  "surface", "platform", "markdown", "storage/indexeddb",
]

/// JavaScript that only reads the page, so drawing and decoding code may
/// call it. Every other JavaScript function outside the core counts as
/// changing something.
const measures = [
  "drawnInPage", "caretLine", "locate", "textWidth", "utf16Split", "utf16Length",
  "below", "hasHardwareKeyboard", "readVimSetting", "readMarkdownSetting",
]

const regexes_in_shell_javascript = ["Mac|iPhone|iPad", "\\n$"]

const decoders_that_still_read_the_editor = ["surface.key_decoder"]

const pure_results = ["Element", "Attribute", "Decoder"]

pub type Source {
  /// `path` is relative to `src`: "nullpad/editor.gleam".
  Source(path: String, text: String)
}

pub type Rule {
  CoreImports
  CoreJavaScript
  JavaScriptFile
  CallsJavaScript
  BackendImport
  FieldWrite
  JavaScriptRegex
  MarkdownMarker
  ChangesPage
  MeasureChanges
  DecoderTakesEditor
}

pub const rules = [
  CoreImports,
  CoreJavaScript,
  JavaScriptFile,
  CallsJavaScript,
  BackendImport,
  FieldWrite,
  JavaScriptRegex,
  MarkdownMarker,
  ChangesPage,
  MeasureChanges,
  DecoderTakesEditor,
]

pub fn says(rule: Rule) -> String {
  case rule {
    CoreImports -> "a core module imports only gleam and other core modules"
    CoreJavaScript -> "a core module's JavaScript touches no browser"
    JavaScriptFile ->
      "only surface, platform, markdown and a storage backend have JavaScript"
    CallsJavaScript ->
      "only surface, platform, markdown and a storage backend call JavaScript"
    BackendImport -> "only src/nullpad.gleam imports a storage backend"
    FieldWrite -> "only surface writes the text field"
    JavaScriptRegex ->
      "JavaScript outside the core has no regex, the Gleam parser reads text"
    MarkdownMarker -> "only the core knows markdown markers"
    ChangesPage -> "code that draws or decodes never changes the page"
    MeasureChanges -> "JavaScript listed as measuring changes nothing"
    DecoderTakesEditor ->
      "a decoder takes no Editor, it would be the last drawn frame's"
  }
}

pub type Broken {
  Broken(rule: Rule, path: String, detail: String)
}

pub type Report {
  Report(
    broken: List(Broken),
    /// What each rule examined, so a rule that examines nothing shows.
    looked: List(#(Rule, String)),
    /// Problems with this check itself: a rule with nothing to examine, a
    /// listed module that is gone, an allowance nothing needs any more.
    faults: List(String),
  )
}

pub opaque type File {
  Gleam(path: String, name: String, module: glance.Module)
  JavaScript(path: String, name: String, lines: List(String))
  Unreadable(path: String)
}

pub fn read(source: Source) -> File {
  let name =
    source.path
    |> string.replace(".ffi.mjs", "")
    |> string.replace(".mjs", "")
    |> string.replace(".gleam", "")
    |> strip_prefix("nullpad/")
  case string.ends_with(source.path, ".gleam") {
    True ->
      case glance.module(source.text) {
        Ok(module) -> Gleam(source.path, name, module)
        Error(_) -> Unreadable(source.path)
      }
    False -> JavaScript(source.path, name, string.split(source.text, "\n"))
  }
}

pub fn path(file: File) -> String {
  file.path
}

pub fn judge(files: List(File)) -> Report {
  let changers = changers(files)
  let found =
    list.flat_map(files, fn(file) {
      case file {
        Gleam(path:, name:, module:) ->
          list.flatten([
            core_imports(path, name, module),
            calls_javascript(path, name, module),
            backend_import(path, name, module),
            markers_in_gleam(path, name, module),
            changes_page(path, name, module, changers),
            decoder_takes_editor(path, name, module),
          ])
        JavaScript(path:, name:, lines:) -> javascript(path, name, lines)
        Unreadable(_) -> []
      }
    })
  let broken =
    list.filter_map(found, fn(one) {
      case one {
        Found(broken) -> Ok(broken)
        Looked(..) -> Error(Nil)
      }
    })
  let looked =
    list.filter_map(found, fn(one) {
      case one {
        Looked(rule, at) -> Ok(#(rule, at))
        Found(_) -> Error(Nil)
      }
    })
  Report(broken:, looked:, faults: faults(files, looked))
}

type Finding {
  Found(Broken)
  Looked(rule: Rule, at: String)
}

fn is_core(name: String) -> Bool {
  list.contains(core, name)
}

fn strip_prefix(text: String, prefix: String) -> String {
  case string.starts_with(text, prefix) {
    True -> string.drop_start(text, string.length(prefix))
    False -> text
  }
}

fn core_imports(
  path: String,
  name: String,
  module: glance.Module,
) -> List(Finding) {
  use <- when(is_core(name))
  let broken =
    list.filter_map(module.imports, fn(definition) {
      let imported = definition.definition.module
      let other = strip_prefix(imported, "nullpad/")
      let fine =
        string.starts_with(imported, "gleam/")
        || {
          string.starts_with(imported, "nullpad/")
          && {
            is_core(other)
            || list.contains(core_may_also_import, #(name, other))
          }
        }
      case fine {
        True -> Error(Nil)
        False -> Ok(Found(Broken(CoreImports, path, "import " <> imported)))
      }
    })
  [Looked(CoreImports, path), ..broken]
}

fn calls_javascript(
  path: String,
  name: String,
  module: glance.Module,
) -> List(Finding) {
  use <- when(!list.contains(may_call_javascript, name))
  let broken =
    list.filter_map(module.functions, fn(definition) {
      case external(definition) {
        Some(_) ->
          Ok(Found(Broken(CallsJavaScript, path, definition.definition.name)))
        None -> Error(Nil)
      }
    })
  [Looked(CallsJavaScript, path), ..broken]
}

fn backend_import(
  path: String,
  name: String,
  module: glance.Module,
) -> List(Finding) {
  use <- when(name != "nullpad")
  let broken =
    list.filter_map(module.imports, fn(definition) {
      let imported = definition.definition.module
      case string.starts_with(imported, "nullpad/storage/") {
        True -> Ok(Found(Broken(BackendImport, path, "import " <> imported)))
        False -> Error(Nil)
      }
    })
  [Looked(BackendImport, path), ..broken]
}

fn markers_in_gleam(
  path: String,
  name: String,
  module: glance.Module,
) -> List(Finding) {
  use <- when(!is_core(name))
  let marker = marker_pattern("^")
  let in_functions =
    list.flat_map(module.functions, fn(definition) {
      statements(definition.definition.body)
    })
  let in_constants =
    list.flat_map(module.constants, fn(definition) {
      expression(definition.definition.value)
    })
  let broken =
    list.append(in_functions, in_constants)
    |> list.filter_map(fn(seen) {
      case seen {
        Text(text) ->
          case regexp.check(marker, text) || text == "#" || text == ">" {
            True ->
              Ok(Found(Broken(MarkdownMarker, path, "\"" <> text <> "\"")))
            False -> Error(Nil)
          }
        Name(_) | Remote(..) -> Error(Nil)
      }
    })
  [Looked(MarkdownMarker, path), ..broken]
}

fn changes_page(
  path: String,
  name: String,
  module: glance.Module,
  changers: Set(String),
) -> List(Finding) {
  use <- when(list.contains(drawing, name))
  let key = module_key(path)
  let resolve = resolver(key, module)
  list.flat_map(module.functions, fn(definition) {
    let function = definition.definition
    use <- when(is_pure(function))
    let broken =
      statements(function.body)
      |> list.filter_map(resolve)
      |> list.unique
      |> list.filter(set.contains(changers, _))
      |> list.map(fn(called) {
        Found(Broken(ChangesPage, path, function.name <> " uses " <> called))
      })
    [Looked(ChangesPage, name <> "." <> function.name), ..broken]
  })
}

fn decoder_takes_editor(
  path: String,
  name: String,
  module: glance.Module,
) -> List(Finding) {
  use <- when(list.contains(drawing, name))
  list.flat_map(module.functions, fn(definition) {
    let function = definition.definition
    use <- when(is_decoder(function))
    let full = name <> "." <> function.name
    let takes =
      list.any(function.parameters, fn(parameter) {
        case parameter.type_ {
          Some(glance.NamedType(name: "Editor", ..)) -> True
          _ -> False
        }
      })
    case takes && !list.contains(decoders_that_still_read_the_editor, full) {
      True -> [
        Looked(DecoderTakesEditor, full),
        Found(Broken(DecoderTakesEditor, path, function.name)),
      ]
      False -> [Looked(DecoderTakesEditor, full)]
    }
  })
}

fn is_decoder(function: glance.Function) -> Bool {
  string.ends_with(function.name, "_decoder") || returns(function, ["Decoder"])
}

fn is_pure(function: glance.Function) -> Bool {
  string.ends_with(function.name, "_decoder") || returns(function, pure_results)
}

fn returns(function: glance.Function, names: List(String)) -> Bool {
  case function.return {
    Some(returned) -> mentions(returned, names)
    None -> False
  }
}

/// `List(Element(msg))` and `Option(Decoder(a))` count as well.
fn mentions(type_: glance.Type, names: List(String)) -> Bool {
  case type_ {
    glance.NamedType(name:, parameters:, ..) ->
      list.contains(names, name) || list.any(parameters, mentions(_, names))
    glance.TupleType(elements:, ..) -> list.any(elements, mentions(_, names))
    glance.FunctionType(return:, ..) -> mentions(return, names)
    glance.VariableType(..) | glance.HoleType(..) -> False
  }
}

fn external(definition: glance.Definition(glance.Function)) -> Option(String) {
  list.find_map(definition.attributes, fn(attribute) {
    case attribute {
      glance.Attribute("external", [_, _, glance.String(value:, ..)]) ->
        Ok(value)
      _ -> Error(Nil)
    }
  })
  |> option.from_result
}

fn module_key(path: String) -> String {
  string.replace(path, ".gleam", "")
}

/// Every function that reaches JavaScript which is not a measure, directly
/// or through other functions. Drawing and decoding functions are left out:
/// they are reported themselves.
fn changers(files: List(File)) -> Set(String) {
  let functions =
    list.flat_map(files, fn(file) {
      case file {
        Gleam(path:, name:, module:) -> {
          let key = module_key(path)
          let resolve = resolver(key, module)
          list.map(module.functions, fn(definition) {
            let function = definition.definition
            let uses = statements(function.body) |> list.filter_map(resolve)
            let starts = case external(definition) {
              Some(javascript) ->
                !is_core(name) && !list.contains(measures, javascript)
              None -> False
            }
            #(key <> "." <> function.name, uses, starts, is_pure(function))
          })
        }
        JavaScript(..) | Unreadable(_) -> []
      }
    })
  let start =
    list.filter_map(functions, fn(function) {
      case function.2 {
        True -> Ok(function.0)
        False -> Error(Nil)
      }
    })
    |> set.from_list
  let spreading = list.filter(functions, fn(function) { !function.3 })
  grow(start, spreading)
}

fn grow(
  changers: Set(String),
  functions: List(#(String, List(String), Bool, Bool)),
) -> Set(String) {
  let grown =
    list.fold(functions, changers, fn(grown, function) {
      case list.any(function.1, set.contains(grown, _)) {
        True -> set.insert(grown, function.0)
        False -> grown
      }
    })
  case set.size(grown) == set.size(changers) {
    True -> grown
    False -> grow(grown, functions)
  }
}

/// Turns a name used in `module` into "nullpad/surface.blur_control".
fn resolver(
  key: String,
  module: glance.Module,
) -> fn(Seen) -> Result(String, Nil) {
  let locals =
    list.map(module.functions, fn(definition) { definition.definition.name })
    |> set.from_list
  let aliases: Dict(String, String) =
    list.filter_map(module.imports, fn(definition) {
      let imported = definition.definition
      case imported.alias {
        Some(glance.Named(alias)) -> Ok(#(alias, imported.module))
        Some(glance.Discarded(_)) -> Error(Nil)
        None ->
          string.split(imported.module, "/")
          |> list.last
          |> result.map(fn(alias) { #(alias, imported.module) })
      }
    })
    |> dict.from_list
  let unqualified: Dict(String, String) =
    list.flat_map(module.imports, fn(definition) {
      let imported = definition.definition
      list.map(imported.unqualified_values, fn(value) {
        #(
          option.unwrap(value.alias, value.name),
          imported.module <> "." <> value.name,
        )
      })
    })
    |> dict.from_list
  fn(seen) {
    case seen {
      Name(name) ->
        case set.contains(locals, name) {
          True -> Ok(key <> "." <> name)
          False -> dict.get(unqualified, name)
        }
      Remote(alias, label) ->
        dict.get(aliases, alias)
        |> result.map(fn(module) { module <> "." <> label })
      Text(_) -> Error(Nil)
    }
  }
}

type Seen {
  Name(String)
  Remote(alias: String, label: String)
  Text(String)
}

fn statements(body: List(glance.Statement)) -> List(Seen) {
  list.flat_map(body, fn(statement) {
    case statement {
      glance.Use(function:, patterns:, ..) ->
        list.append(
          list.flat_map(patterns, fn(use_pattern) {
            pattern(use_pattern.pattern)
          }),
          expression(function),
        )
      glance.Assignment(pattern: assigned, value:, kind:, ..) ->
        list.flatten([
          pattern(assigned),
          expression(value),
          case kind {
            glance.LetAssert(message) -> maybe(message)
            glance.Let -> []
          },
        ])
      glance.Assert(expression: asserted, message:, ..) ->
        list.append(expression(asserted), maybe(message))
      glance.Expression(inner) -> expression(inner)
    }
  })
}

fn maybe(wrapped: Option(glance.Expression)) -> List(Seen) {
  case wrapped {
    Some(inner) -> expression(inner)
    None -> []
  }
}

fn fields(given: List(glance.Field(glance.Expression))) -> List(Seen) {
  list.flat_map(given, fn(field) {
    case field {
      glance.LabelledField(item:, ..) -> expression(item)
      glance.ShorthandField(label:, ..) -> [Name(label)]
      glance.UnlabelledField(item) -> expression(item)
    }
  })
}

fn expression(subject: glance.Expression) -> List(Seen) {
  case subject {
    glance.Int(..) | glance.Float(..) -> []
    glance.String(value:, ..) -> [Text(value)]
    glance.Variable(name:, ..) -> [Name(name)]
    glance.NegateInt(value:, ..) | glance.NegateBool(value:, ..) ->
      expression(value)
    glance.Block(statements: inner, ..) -> statements(inner)
    glance.Panic(message:, ..) | glance.Todo(message:, ..) -> maybe(message)
    glance.Tuple(elements:, ..) -> list.flat_map(elements, expression)
    glance.List(elements:, rest:, ..) ->
      list.append(list.flat_map(elements, expression), maybe(rest))
    glance.Fn(body:, ..) -> statements(body)
    glance.RecordUpdate(record:, fields: updated, ..) ->
      list.append(
        expression(record),
        list.flat_map(updated, fn(field) { maybe(field.item) }),
      )
    glance.FieldAccess(container: glance.Variable(name:, ..), label:, ..) -> [
      Remote(name, label),
      Name(name),
    ]
    glance.FieldAccess(container:, ..) -> expression(container)
    glance.Call(function:, arguments:, ..) ->
      list.append(expression(function), fields(arguments))
    glance.TupleIndex(tuple:, ..) -> expression(tuple)
    glance.FnCapture(function:, arguments_before:, arguments_after:, ..) ->
      list.flatten([
        expression(function),
        fields(arguments_before),
        fields(arguments_after),
      ])
    glance.BitString(segments:, ..) ->
      list.flat_map(segments, fn(segment) { expression(segment.0) })
    glance.Case(subjects:, clauses:, ..) ->
      list.append(
        list.flat_map(subjects, expression),
        list.flat_map(clauses, fn(clause) {
          list.flatten([
            list.flat_map(list.flatten(clause.patterns), pattern),
            maybe(clause.guard),
            expression(clause.body),
          ])
        }),
      )
    glance.BinaryOperator(name: glance.Concatenate, ..) ->
      joined(operands(subject), "")
    glance.BinaryOperator(left:, right:, ..) ->
      list.append(expression(left), expression(right))
    glance.Echo(expression: echoed, message:, ..) ->
      list.append(maybe(echoed), maybe(message))
  }
}

fn operands(subject: glance.Expression) -> List(glance.Expression) {
  case subject {
    glance.BinaryOperator(name: glance.Concatenate, left:, right:, ..) ->
      list.append(operands(left), operands(right))
    other -> [other]
  }
}

/// `"-" <> " " <> rest` is seen as the one literal "- ".
fn joined(parts: List(glance.Expression), text: String) -> List(Seen) {
  case parts, text {
    [], "" -> []
    [], text -> [Text(text)]
    [glance.String(value:, ..), ..rest], text -> joined(rest, text <> value)
    [other, ..rest], "" -> list.append(expression(other), joined(rest, ""))
    [other, ..rest], text -> [
      Text(text),
      ..list.append(expression(other), joined(rest, ""))
    ]
  }
}

fn pattern(subject: glance.Pattern) -> List(Seen) {
  case subject {
    glance.PatternString(value:, ..) -> [Text(value)]
    glance.PatternConcatenate(prefix:, ..) -> [Text(prefix)]
    glance.PatternTuple(elements:, ..) -> list.flat_map(elements, pattern)
    glance.PatternList(elements:, tail:, ..) ->
      list.append(list.flat_map(elements, pattern), case tail {
        Some(tail) -> pattern(tail)
        None -> []
      })
    glance.PatternAssignment(pattern: inner, ..) -> pattern(inner)
    glance.PatternVariant(arguments:, ..) ->
      list.flat_map(arguments, fn(field) {
        case field {
          glance.LabelledField(item:, ..) -> pattern(item)
          glance.UnlabelledField(item) -> pattern(item)
          glance.ShorthandField(..) -> []
        }
      })
    glance.PatternInt(..)
    | glance.PatternFloat(..)
    | glance.PatternDiscard(..)
    | glance.PatternVariable(..)
    | glance.PatternBitString(..) -> []
  }
}

fn when(condition: Bool, otherwise: fn() -> List(a)) -> List(a) {
  case condition {
    True -> otherwise()
    False -> []
  }
}

fn pattern_from(source: String) -> Regexp {
  let assert Ok(compiled) = regexp.from_string(source)
  compiled
}

fn marker_pattern(before: String) -> Regexp {
  pattern_from(
    before <> "(#{1,6} |[-*+] |> |```|~~~|[0-9]+[.)] |- \\[|\\[[ xX]\\])",
  )
}

fn regex_literal() -> Regexp {
  pattern_from(
    "(?<=(?:^|[=(,:!&|?{};]|=>|\\breturn)\\s*)/((?:\\\\.|[^/\\\\\\n])+)/[dgimsuy]*(?=\\s*(?:[.,);]|$))",
  )
}

fn regex_bodies(line: String) -> List(String) {
  regexp.scan(regex_literal(), line)
  |> list.filter_map(fn(match) {
    case match.submatches {
      [Some(body), ..] -> Ok(body)
      _ -> Error(Nil)
    }
  })
}

fn javascript(
  path: String,
  name: String,
  lines: List(String),
) -> List(Finding) {
  let code =
    list.index_map(lines, fn(line, index) { #(index + 1, string.trim(line)) })
    |> list.filter(fn(line) { !string.starts_with(line.1, "//") })
  let each = fn(rule: Rule, breaks: fn(String) -> Bool) {
    let broken =
      list.filter_map(code, fn(line) {
        case breaks(line.1) {
          True ->
            Ok(
              Found(Broken(rule, path <> ":" <> string.inspect(line.0), line.1)),
            )
          False -> Error(Nil)
        }
      })
    [Looked(rule, path), ..broken]
  }
  let browser =
    pattern_from(
      "\\b(document|window|navigator|localStorage|sessionStorage|indexedDB|globalThis|self)\\b",
    )
  let field_write =
    pattern_from(
      "\\.(value|selectionStart|selectionEnd)\\s*[-+]?=(?!=)|\\b(setRangeText|setSelectionRange|execCommand)\\b",
    )
  let builds_regex = pattern_from("\\bRegExp\\b")
  let marker = marker_pattern("[\"'`]")
  list.flatten([
    [Looked(JavaScriptFile, path)],
    when(!list.contains(may_call_javascript, name), fn() {
      [Found(Broken(JavaScriptFile, path, "this file"))]
    }),
    when(is_core(name), fn() { each(CoreJavaScript, regexp.check(browser, _)) }),
    when(name != "surface", fn() {
      each(FieldWrite, regexp.check(field_write, _))
    }),
    when(!is_core(name), fn() {
      list.flatten([
        each(JavaScriptRegex, fn(line) {
          regexp.check(builds_regex, line)
          || list.any(regex_bodies(line), fn(body) {
            !list.contains(regexes_in_shell_javascript, body)
          })
        }),
        each(MarkdownMarker, regexp.check(marker, _)),
        measure_changes(path, lines),
      ])
    }),
  ])
}

fn measure_changes(path: String, lines: List(String)) -> List(Finding) {
  let changes =
    pattern_from(
      "\\.(focus|blur|click|scrollIntoView|scrollTo|setSelectionRange|setRangeText|setItem|removeItem|addEventListener|writeText)\\(|\\.(value|selectionStart|selectionEnd|scrollTop|scrollLeft)\\s*[-+]?=(?!=)",
    )
  let opening = pattern_from("^export function (\\w+)\\(")
  let #(found, _, _) =
    list.fold(lines, #([], None, 1), fn(state, line) {
      let #(found, inside, number) = state
      let comment = string.starts_with(string.trim(line), "//")
      case regexp.scan(opening, line), inside {
        [regexp.Match(submatches: [Some(function)], ..), ..], _ ->
          case list.contains(measures, function) {
            True -> #(
              [Looked(MeasureChanges, function), ..found],
              Some(function),
              number + 1,
            )
            False -> #(found, None, number + 1)
          }
        _, Some(_) if line == "}" -> #(found, None, number + 1)
        _, Some(function) if !comment ->
          case regexp.check(changes, line) {
            True -> #(
              [
                Found(Broken(
                  MeasureChanges,
                  path <> ":" <> string.inspect(number),
                  function <> ": " <> string.trim(line),
                )),
                ..found
              ],
              inside,
              number + 1,
            )
            False -> #(found, inside, number + 1)
          }
        _, _ -> #(found, inside, number + 1)
      }
    })
  list.reverse(found)
}

fn faults(files: List(File), looked: List(#(Rule, String))) -> List(String) {
  let names =
    list.map(files, fn(file) {
      case file {
        Gleam(name:, ..) | JavaScript(name:, ..) -> name
        Unreadable(path) -> path
      }
    })
  let unreadable =
    list.filter_map(files, fn(file) {
      case file {
        Unreadable(path) -> Ok("glance could not parse " <> path)
        Gleam(..) | JavaScript(..) -> Error(Nil)
      }
    })
  let missing =
    list.flatten([core, drawing, may_call_javascript])
    |> list.unique
    |> list.filter(fn(name) { !list.contains(names, name) })
    |> list.map(fn(name) { "a listed module does not exist: " <> name })
  let idle =
    list.filter(rules, fn(rule) { !list.any(looked, fn(one) { one.0 == rule }) })
    |> list.map(fn(rule) { "a rule examined nothing: " <> says(rule) })
  let externals =
    list.flat_map(files, fn(file) {
      case file {
        Gleam(module:, ..) ->
          list.filter_map(module.functions, fn(definition) {
            option.to_result(external(definition), Nil)
          })
        JavaScript(..) | Unreadable(_) -> []
      }
    })
  let regexes =
    list.flat_map(files, fn(file) {
      case file {
        JavaScript(lines:, ..) ->
          list.flat_map(lines, fn(line) { regex_bodies(string.trim(line)) })
        Gleam(..) | Unreadable(_) -> []
      }
    })
  let decoders = list.map(looked, fn(one) { one.1 })
  let unused = fn(allowed: List(String), used: List(String), what: String) {
    list.filter(allowed, fn(one) { !list.contains(used, one) })
    |> list.map(fn(one) {
      "nothing needs this " <> what <> " any more: " <> one
    })
  }
  list.flatten([
    unreadable,
    missing,
    idle,
    unused(measures, externals, "measure"),
    unused(regexes_in_shell_javascript, regexes, "regex allowance"),
    unused(decoders_that_still_read_the_editor, decoders, "decoder allowance"),
  ])
}
