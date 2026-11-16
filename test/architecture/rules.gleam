//// The architecture rules in AGENTS.md, as a check over the syntax tree.
//// Gleam files are parsed with glance, so imports, calls and types are the
//// real ones. JavaScript is only checked for where it lives: what it does
//// inside a file is left to review, because matching its text line by line
//// let most breaks through.
////
//// The defaults fail: a module nobody listed, a function with no return
//// type and JavaScript nobody called a measure are all reported, so new
//// code has to say what it is before it passes.

import glance
import gleam/dict.{type Dict}
import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/result
import gleam/set.{type Set}
import gleam/string

/// Pure modules: no Lustre, no browser.
const core = [
  "buffer",
  "vim",
  "editor",
  "history",
  "live",
  "markdown",
  "library",
]

const core_may_also_import = [#("library", "storage")]

/// Everything else that is not a storage backend under `storage/`.
const shell = ["nullpad", "app", "surface", "preview", "platform", "storage"]

const with_javascript = ["surface", "platform", "markdown"]

/// JavaScript in surface and platform that only reads the page. Every other
/// function there counts as changing it.
const measures = [
  "drawnInPage", "holdsFocus", "caretLine", "headLine", "holderText",
  "paintedOnPage", "locate", "findControl", "textWidth", "utf16Split",
  "utf16Length", "below", "hasHardwareKeyboard", "canPaint", "readVimSetting",
  "readMarkdownSetting", "pressLanding", "dropped", "releasedOnSelection",
  "focusStayed", "currentEditor", "pastedText", "heldKeyEvent",
]

/// JavaScript that hands back app state an effect noted there, such as the
/// editor the last message left. A callback reads the latest editor through
/// one when a handler runs.
const records = ["currentEditor"]

/// The types that hold app state from one message to the next: the editor,
/// its undo history, the notes and vim's modes. A type in `src` that holds
/// one is app state too, which makes the model app state. A buffer is not:
/// the field reports one with each event, for a decoder to hand on.
const state_roots = ["Editor", "History", "Library", "State"]

pub type Source {
  /// `path` is relative to `src`: "nullpad/editor.gleam".
  Source(path: String, text: String)
}

pub type Rule {
  Listed
  Annotated
  CoreImports
  JavaScriptFile
  CallsJavaScript
  BackendImport
  FieldWrite
  ChangesPage
  DecoderState
  SkipsOutcome
  RawHtml
}

pub const rules = [
  Listed,
  Annotated,
  CoreImports,
  JavaScriptFile,
  CallsJavaScript,
  BackendImport,
  FieldWrite,
  ChangesPage,
  DecoderState,
  SkipsOutcome,
  RawHtml,
]

pub fn says(rule: Rule) -> String {
  case rule {
    Listed -> "every module is listed as core, shell or a storage backend"
    Annotated -> "every function says what it takes and returns"
    CoreImports -> "a core module imports only gleam and other core modules"
    JavaScriptFile ->
      "JavaScript lives in the .ffi.mjs of surface, platform, markdown or a storage backend"
    CallsJavaScript ->
      "only surface, platform, markdown and a storage backend call JavaScript, each its own file"
    BackendImport -> "only src/nullpad.gleam imports a storage backend"
    FieldWrite -> "only surface draws the text field"
    ChangesPage ->
      "only a function that returns an Effect or Nil may change the page"
    DecoderState ->
      "a handler is made only where no app state is in scope, from callbacks that read app state when it runs"
    SkipsOutcome ->
      "a public editor function that changes the editor returns an Outcome"
    RawHtml -> "nothing draws raw HTML"
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
  JavaScript(path: String, name: String)
  Other(path: String)
  Unreadable(path: String)
}

pub fn read(source: Source) -> File {
  let gleam = string.ends_with(source.path, ".gleam")
  let javascript = string.ends_with(source.path, ".ffi.mjs")
  let stem =
    source.path
    |> string.replace(".ffi.mjs", "")
    |> string.replace(".gleam", "")
  let name = case stem, string.starts_with(stem, "nullpad/") {
    "nullpad", _ -> stem
    _, True -> strip_prefix(stem, "nullpad/")
    _, False -> "src/" <> stem
  }
  case gleam, javascript {
    True, _ ->
      case glance.module(source.text) {
        Ok(module) -> Gleam(source.path, name, module)
        Error(_) -> Unreadable(source.path)
      }
    False, True -> JavaScript(source.path, name)
    False, False -> Other(source.path)
  }
}

pub fn path(file: File) -> String {
  file.path
}

pub fn judge(files: List(File)) -> Report {
  let changers = changers(files)
  let context = context(files)
  let found =
    list.flat_map(files, fn(file) {
      case file {
        Gleam(path:, name:, module:) ->
          list.flatten([
            listed(path, name),
            annotated(path, module),
            core_imports(path, name, module),
            calls_javascript(path, name, module),
            backend_import(path, name, module),
            changes_page(path, name, module, changers),
            decoder_state(path, name, module, context),
            skips_outcome(path, name, module),
            forbidden_calls(path, name, module),
          ])
        JavaScript(path:, name:) -> javascript(path, name)
        Other(path) -> [
          Found(Broken(JavaScriptFile, path, "not a .gleam or .ffi.mjs file")),
        ]
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
  let looked = [
    #(DecoderState, "app state is " <> string.join(context.state, ", ")),
    ..looked
  ]
  Report(broken:, looked:, faults: faults(files, looked))
}

type Finding {
  Found(Broken)
  Looked(rule: Rule, at: String)
}

fn is_core(name: String) -> Bool {
  list.contains(core, name)
}

fn is_backend(name: String) -> Bool {
  string.starts_with(name, "storage/")
}

fn has_javascript(name: String) -> Bool {
  list.contains(with_javascript, name) || is_backend(name)
}

/// Whose JavaScript can change the page. A storage backend's cannot.
fn touches_page(name: String) -> Bool {
  !is_core(name) && !is_backend(name)
}

fn strip_prefix(text: String, prefix: String) -> String {
  case string.starts_with(text, prefix) {
    True -> string.drop_start(text, string.length(prefix))
    False -> text
  }
}

fn when(condition: Bool, otherwise: fn() -> List(a)) -> List(a) {
  case condition {
    True -> otherwise()
    False -> []
  }
}

fn listed(path: String, name: String) -> List(Finding) {
  case is_core(name) || list.contains(shell, name) || is_backend(name) {
    True -> [Looked(Listed, path)]
    False -> [
      Looked(Listed, path),
      Found(Broken(
        Listed,
        path,
        "add \""
          <> name
          <> "\" to core or shell in test/architecture/rules.gleam",
      )),
    ]
  }
}

fn annotated(path: String, module: glance.Module) -> List(Finding) {
  let broken =
    list.flat_map(module.functions, fn(definition) {
      let function = definition.definition
      let untyped =
        list.any(function.parameters, fn(parameter) {
          option.map(parameter.type_, has_hole) |> option.unwrap(True)
        })
      let no_return =
        option.map(function.return, has_hole) |> option.unwrap(True)
      list.flatten([
        when(no_return, fn() {
          [
            Found(Broken(
              Annotated,
              path,
              function.name <> " has no return type",
            )),
          ]
        }),
        when(untyped, fn() {
          [
            Found(Broken(
              Annotated,
              path,
              function.name <> " has an untyped parameter",
            )),
          ]
        }),
      ])
    })
  [Looked(Annotated, path), ..broken]
}

fn has_hole(type_: glance.Type) -> Bool {
  case type_ {
    glance.HoleType(..) -> True
    glance.VariableType(..) -> False
    glance.NamedType(parameters:, ..) -> list.any(parameters, has_hole)
    glance.TupleType(elements:, ..) -> list.any(elements, has_hole)
    glance.FunctionType(parameters:, return:, ..) ->
      has_hole(return) || list.any(parameters, has_hole)
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
  let own =
    "./"
    <> { string.split(name, "/") |> list.last |> result.unwrap(name) }
    <> ".ffi.mjs"
  let broken =
    list.filter_map(module.functions, fn(definition) {
      let function = definition.definition.name
      case external(definition), has_javascript(name) {
        Some(_), False -> Ok(Found(Broken(CallsJavaScript, path, function)))
        Some(External(file:, ..)), True if file != own ->
          Ok(
            Found(Broken(CallsJavaScript, path, function <> " calls " <> file)),
          )
        _, _ -> Error(Nil)
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

fn changes_page(
  path: String,
  name: String,
  module: glance.Module,
  changers: Set(String),
) -> List(Finding) {
  use <- when(!is_core(name))
  let key = module_key(path)
  let resolve = resolver(key, module)
  let aliases = aliases_of(module)
  let broken =
    list.flat_map(module.functions, fn(definition) {
      let function = definition.definition
      use <- when(!may_change(function, aliases))
      uses(function, resolve)
      |> list.filter(set.contains(changers, _))
      |> list.map(fn(called) {
        Found(Broken(ChangesPage, path, function.name <> " uses " <> called))
      })
    })
  let examined =
    list.count(module.functions, fn(definition) {
      !may_change(definition.definition, aliases)
    })
  [
    Looked(
      ChangesPage,
      name <> " (" <> int.to_string(examined) <> " functions)",
    ),
    ..broken
  ]
}

fn may_change(
  function: glance.Function,
  aliases: Dict(String, glance.Type),
) -> Bool {
  case option.map(function.return, expand(_, aliases)) {
    Some(glance.NamedType(name: "Nil", ..)) -> True
    Some(returned) -> mentions(returned, ["Effect"])
    None -> False
  }
}

/// This module's type aliases, and the types it imports under another name.
fn aliases_of(module: glance.Module) -> Dict(String, glance.Type) {
  let renamed =
    list.flat_map(module.imports, fn(definition) {
      let imported = definition.definition
      list.filter_map(imported.unqualified_types, fn(type_) {
        case type_.alias {
          Some(alias) ->
            Ok(#(
              alias,
              glance.NamedType(
                location: imported.location,
                name: type_.name,
                module: None,
                parameters: [],
              ),
            ))
          None -> Error(Nil)
        }
      })
    })
  list.map(module.type_aliases, fn(definition) {
    #(definition.definition.name, definition.definition.aliased)
  })
  |> list.append(renamed, _)
  |> dict.from_list
}

/// The type with this module's own aliases replaced by what they stand for.
fn expand(
  type_: glance.Type,
  aliases: Dict(String, glance.Type),
) -> glance.Type {
  let each = list.map(_, expand(_, aliases))
  case type_ {
    glance.NamedType(location:, name:, module: None, parameters:) ->
      case dict.get(aliases, name) {
        Ok(glance.NamedType(parameters: [], ..) as aliased) ->
          expand(
            glance.NamedType(..aliased, parameters:),
            dict.delete(aliases, name),
          )
        Ok(aliased) -> expand(aliased, dict.delete(aliases, name))
        Error(Nil) ->
          glance.NamedType(
            location:,
            name:,
            module: None,
            parameters: each(parameters),
          )
      }
    glance.NamedType(location:, name:, module:, parameters:) ->
      glance.NamedType(location:, name:, module:, parameters: each(parameters))
    glance.TupleType(location:, elements:) ->
      glance.TupleType(location:, elements: each(elements))
    glance.FunctionType(location:, parameters:, return:) ->
      glance.FunctionType(
        location:,
        parameters: each(parameters),
        return: expand(return, aliases),
      )
    glance.VariableType(..) | glance.HoleType(..) -> type_
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

/// Where a handler or decoder is made. A function that makes one may not
/// have app state in scope: what a handler decides on is what the event
/// brings and what its callbacks read when it runs, never the frame the
/// page last drew. A function with app state in scope draws, and calls a
/// function that makes the handlers.
fn decoder_state(
  path: String,
  name: String,
  module: glance.Module,
  context: Context,
) -> List(Finding) {
  use <- when(!is_core(name) && !is_backend(name))
  let aliases = aliases_of(module)
  let resolve = resolver(module_key(path), module)
  let in_module = fn(callee: glance.Expression, among: Set(String)) {
    case seen_callee(callee) {
      Some(seen) ->
        case resolve(seen) {
          Ok(called) ->
            case set.contains(among, called) {
              True -> Some(called)
              False -> None
            }
          Error(Nil) -> None
        }
      None -> None
    }
  }
  let modules =
    list.filter_map(module.imports, fn(definition) {
      let imported = definition.definition
      case imported.alias {
        Some(glance.Named(alias)) -> Ok(alias)
        Some(glance.Discarded(_)) -> Error(Nil)
        None -> string.split(imported.module, "/") |> list.last
      }
    })
    |> set.from_list
  let measured =
    list.filter_map(module.functions, fn(definition) {
      let function = definition.definition
      case external(definition), function.return {
        Some(External(function: javascript, ..)), Some(returned) ->
          case
            list.contains(measures, javascript)
            && !list.contains(records, javascript)
            && mentions(expand(returned, aliases), context.state)
          {
            True ->
              Ok(
                Found(Broken(
                  DecoderState,
                  path,
                  function.name
                    <> " is a measure that hands back app state: list it under records",
                )),
              )
            False -> Error(Nil)
          }
        _, _ -> Error(Nil)
      }
    })
  let judged =
    list.map(module.functions, fn(definition) {
      let function = definition.definition
      let state = state_parameters(function, aliases, context.state)
      let callbacks = state_callbacks(function, aliases, context.state)
      let used = uses(function, resolve)
      let runs =
        list.contains(used, "gleam/dynamic/decode.run")
        && !is_decoder(function, aliases)
      let made = list.filter(used, builds(_, context.decoders, runs))
      let read = list.filter(used, set.contains(context.readers, _))
      let scope =
        Scope(
          state: set.from_list(state),
          modules:,
          shell: in_module(_, context.shell),
          record: fn(callee) { in_module(callee, context.latest) != None },
        )
      let broken =
        list.flatten([
          case state, made {
            [held, ..], [called, ..] -> [
              function.name
              <> " makes a handler with "
              <> held
              <> " in scope, through "
              <> called,
            ]
            _, _ -> []
          },
          case read, made {
            [reader, ..], [called, ..] -> [
              function.name
              <> " makes a handler through "
              <> called
              <> " and reads app state from JavaScript through "
              <> reader,
            ]
            _, _ -> []
          },
          handed_in(function.body, scope)
            |> list.unique
            |> list.map(fn(called) {
              function.name
              <> " hands "
              <> called
              <> " a callback over app state"
            }),
          case made {
            [] -> []
            [_, ..] ->
              early_in(function.body, scope, callbacks, in_module(
                _,
                set.from_list(decodes),
              ))
              |> list.unique
              |> list.map(fn(callback) {
                function.name
                <> " calls "
                <> callback
                <> " while it makes the handler, not when it runs"
              })
          },
        ])
      #(state != [], made != [], broken)
    })
  let count = fn(picks: fn(#(Bool, Bool, List(String))) -> Bool) {
    int.to_string(list.count(judged, picks))
  }
  [
    Looked(
      DecoderState,
      name
        <> " ("
        <> count(fn(one) { one.1 })
        <> " make handlers or decoders, "
        <> count(fn(one) { one.0 })
        <> " hold app state)",
    ),
    ..list.append(
      measured,
      list.flat_map(judged, fn(one) {
        list.map(one.2, fn(detail) { Found(Broken(DecoderState, path, detail)) })
      }),
    )
  ]
}

/// A call that makes a handler or a decoder. A function that runs a decoder
/// itself, with `decode.run`, and hands none back makes no handler with it.
fn builds(called: String, decoders: Set(String), runs: Bool) -> Bool {
  string.starts_with(called, "lustre/event.")
  || called == "lustre/element.map"
  || !runs
  && {
    string.starts_with(called, "gleam/dynamic/decode.")
    && called != "gleam/dynamic/decode.run"
    || set.contains(decoders, called)
  }
}

fn is_decoder(
  function: glance.Function,
  aliases: Dict(String, glance.Type),
) -> Bool {
  string.ends_with(function.name, "_decoder")
  || case function.return {
    Some(returned) -> mentions(expand(returned, aliases), ["Decoder"])
    None -> False
  }
}

/// The parameters that hold app state. A callback does not, even one that
/// hands back the editor: it reads the editor when it is called.
fn state_parameters(
  function: glance.Function,
  aliases: Dict(String, glance.Type),
  state: List(String),
) -> List(String) {
  list.filter_map(function.parameters, fn(parameter) {
    case parameter.name, option.map(parameter.type_, expand(_, aliases)) {
      glance.Named(_), Some(glance.FunctionType(..)) -> Error(Nil)
      glance.Named(name), Some(type_) ->
        case mentions(type_, state) {
          True -> Ok(name)
          False -> Error(Nil)
        }
      _, _ -> Error(Nil)
    }
  })
}

/// The callbacks that hand back app state.
fn state_callbacks(
  function: glance.Function,
  aliases: Dict(String, glance.Type),
  state: List(String),
) -> Set(String) {
  list.filter_map(function.parameters, fn(parameter) {
    case parameter.name, option.map(parameter.type_, expand(_, aliases)) {
      glance.Named(name), Some(glance.FunctionType(return:, ..)) ->
        case mentions(return, state) {
          True -> Ok(name)
          False -> Error(Nil)
        }
      _, _ -> Error(Nil)
    }
  })
  |> set.from_list
}

/// The callbacks in `callbacks` that `body` calls as it runs: outside any
/// closure, and before any `use` of a decoder, whose rest runs when the
/// event comes.
fn early_in(
  body: List(glance.Statement),
  scope: Scope,
  callbacks: Set(String),
  decodes: fn(glance.Expression) -> Option(String),
) -> List(String) {
  let early = early(_, scope, callbacks, decodes)
  case body {
    [] -> []
    [glance.Use(function:, ..), ..rest] -> {
      let later = case function {
        glance.Call(function: callee, ..) -> decodes(callee) != None
        _ -> False
      }
      case later {
        True -> early(function)
        False ->
          list.append(
            early(function),
            early_in(rest, scope, callbacks, decodes),
          )
      }
    }
    [glance.Assignment(value: inner, ..), ..rest]
    | [glance.Expression(inner), ..rest]
    | [glance.Assert(expression: inner, ..), ..rest] ->
      list.append(early(inner), early_in(rest, scope, callbacks, decodes))
  }
}

fn early(
  subject: glance.Expression,
  scope: Scope,
  callbacks: Set(String),
  decodes: fn(glance.Expression) -> Option(String),
) -> List(String) {
  let called = case subject {
    glance.Call(function: glance.Variable(name:, ..), ..) ->
      case set.contains(callbacks, name) {
        True -> [name]
        False -> []
      }
    _ -> []
  }
  let inside = case subject {
    glance.Fn(..) -> []
    glance.Block(statements:, ..) ->
      early_in(statements, scope, callbacks, decodes)
    _ ->
      list.flat_map(parts(subject, scope), fn(part) {
        early(part.0, part.1, callbacks, decodes)
      })
  }
  list.append(called, inside)
}

type Context {
  Context(
    /// The names of the types that hold app state.
    state: List(String),
    /// The shell's functions, which a callback is handed to.
    shell: Set(String),
    /// The shell's decoder functions.
    decoders: Set(String),
    /// Functions that reach a JavaScript record.
    readers: Set(String),
    /// Readers that hand back app state, such as `current_editor`: a
    /// callback reads the editor the last message left through one.
    latest: Set(String),
  )
}

/// The functions of `gleam/dynamic/decode` whose callback runs when the event
/// comes.
const decodes = [
  "gleam/dynamic/decode.then", "gleam/dynamic/decode.field",
  "gleam/dynamic/decode.optional_field", "gleam/dynamic/decode.subfield",
  "gleam/dynamic/decode.map",
]

fn context(files: List(File)) -> Context {
  let state = state_types(files)
  let readers = readers(files)
  let functions =
    list.flat_map(files, fn(file) {
      case file {
        Gleam(path:, name:, module:) ->
          list.map(module.functions, fn(definition) {
            let function = definition.definition
            #(
              module_key(path) <> "." <> function.name,
              !is_core(name) && !is_backend(name),
              function,
              aliases_of(module),
            )
          })
        JavaScript(..) | Other(_) | Unreadable(_) -> []
      }
    })
  let keys = fn(picks) {
    list.filter_map(functions, fn(one) {
      case picks(one) {
        True -> Ok(one.0)
        False -> Error(Nil)
      }
    })
    |> set.from_list
  }
  Context(
    state:,
    shell: keys(fn(one) { one.1 }),
    decoders: keys(fn(one) { one.1 && is_decoder(one.2, one.3) }),
    readers:,
    latest: keys(fn(one) {
      set.contains(readers, one.0)
      && case one.2.return {
        Some(returned) -> mentions(expand(returned, one.3), state)
        None -> False
      }
    }),
  )
}

fn state_types(files: List(File)) -> List(String) {
  let types =
    list.flat_map(files, fn(file) {
      case file {
        Gleam(module:, ..) ->
          list.append(
            list.map(module.custom_types, fn(definition) {
              let custom = definition.definition
              #(
                custom.name,
                list.flat_map(custom.variants, fn(variant) {
                  list.map(variant.fields, fn(field) {
                    case field {
                      glance.LabelledVariantField(item:, ..)
                      | glance.UnlabelledVariantField(item:) -> item
                    }
                  })
                }),
              )
            }),
            list.map(module.type_aliases, fn(definition) {
              #(definition.definition.name, [definition.definition.aliased])
            }),
          )
        JavaScript(..) | Other(_) | Unreadable(_) -> []
      }
    })
  holding(state_roots, types)
}

fn holding(
  state: List(String),
  types: List(#(String, List(glance.Type))),
) -> List(String) {
  let grown =
    list.fold(types, state, fn(state, one) {
      case !list.contains(state, one.0) && list.any(one.1, mentions(_, state)) {
        True -> list.append(state, [one.0])
        False -> state
      }
    })
  case list.length(grown) == list.length(state) {
    True -> grown
    False -> holding(grown, types)
  }
}

type Scope {
  Scope(
    /// The parameters that hold app state.
    state: Set(String),
    /// Import aliases: `editor.claims` names a function, not a field.
    modules: Set(String),
    /// The shell function this names, if it names one.
    shell: fn(glance.Expression) -> Option(String),
    /// Whether this names a reader that hands back app state.
    record: fn(glance.Expression) -> Bool,
  )
}

fn seen_callee(callee: glance.Expression) -> Option(Seen) {
  case callee {
    glance.Variable(name:, ..) -> Some(Name(name))
    glance.FieldAccess(container: glance.Variable(name:, ..), label:, ..) ->
      Some(Remote(name, label))
    _ -> None
  }
}

fn binding(scope: Scope, names: List(String), held: Bool) -> Scope {
  let state = case held {
    True -> list.fold(names, scope.state, set.insert)
    False -> list.fold(names, scope.state, set.delete)
  }
  Scope(..scope, state:)
}

fn bound(patterns: List(glance.Pattern)) -> List(String) {
  list.flat_map(patterns, pattern)
  |> list.filter_map(fn(seen) {
    case seen {
      Bound(name) -> Ok(name)
      Name(_) | Remote(..) | Text(_) -> Error(Nil)
    }
  })
}

fn parameter_names(parameters: List(glance.FnParameter)) -> List(String) {
  list.filter_map(parameters, fn(parameter) {
    case parameter.name {
      glance.Named(name) -> Ok(name)
      glance.Discarded(_) -> Error(Nil)
    }
  })
}

fn items(
  given: List(glance.Field(glance.Expression)),
) -> List(glance.Expression) {
  list.map(given, fn(field) {
    case field {
      glance.LabelledField(item:, ..) | glance.UnlabelledField(item) -> item
      glance.ShorthandField(label:, location:) ->
        glance.Variable(location:, name: label)
    }
  })
}

fn updated(
  location: glance.Span,
  fields: List(glance.RecordUpdateField(glance.Expression)),
) -> List(glance.Expression) {
  list.map(fields, fn(field) {
    option.unwrap(field.item, glance.Variable(location:, name: field.label))
  })
}

/// The parts of `subject` that are expressions, each with the scope it is in.
fn parts(
  subject: glance.Expression,
  scope: Scope,
) -> List(#(glance.Expression, Scope)) {
  let here = list.map(_, fn(part) { #(part, scope) })
  case subject {
    glance.Int(..)
    | glance.Float(..)
    | glance.String(..)
    | glance.Variable(..) -> []
    glance.FieldAccess(container:, ..) -> here([container])
    glance.TupleIndex(tuple:, ..) -> here([tuple])
    glance.NegateInt(value:, ..) | glance.NegateBool(value:, ..) ->
      here([value])
    glance.Call(function:, arguments:, ..) ->
      here([function, ..items(arguments)])
    glance.FnCapture(function:, arguments_before:, arguments_after:, ..) ->
      here([
        function,
        ..list.append(items(arguments_before), items(arguments_after))
      ])
    glance.BinaryOperator(left:, right:, ..) -> here([left, right])
    glance.Tuple(elements:, ..) -> here(elements)
    glance.List(elements:, rest:, ..) ->
      here(list.append(elements, option.values([rest])))
    glance.RecordUpdate(location:, record:, fields:, ..) ->
      here([record, ..updated(location, fields)])
    glance.Panic(message:, ..) | glance.Todo(message:, ..) ->
      here(option.values([message]))
    glance.Echo(expression:, message:, ..) ->
      here(option.values([expression, message]))
    glance.BitString(segments:, ..) ->
      here(list.map(segments, fn(segment) { segment.0 }))
    glance.Case(subjects:, clauses:, ..) ->
      list.append(
        here(subjects),
        list.flat_map(clauses, fn(clause) {
          let inner =
            binding(scope, bound(list.flatten(clause.patterns)), False)
          list.map([clause.body, ..option.values([clause.guard])], fn(part) {
            #(part, inner)
          })
        }),
      )
    glance.Fn(..) | glance.Block(..) -> []
  }
}

/// Whether `subject` reads a name that holds app state. The editor handed to
/// a record does not count: that is how a callback reads the latest one.
fn refers(subject: glance.Expression, scope: Scope) -> Bool {
  case subject {
    glance.Variable(name:, ..) -> set.contains(scope.state, name)
    glance.FieldAccess(container: glance.Variable(name:, ..), ..) ->
      !set.contains(scope.modules, name) && set.contains(scope.state, name)
    glance.Call(function:, ..) | glance.FnCapture(function:, ..) ->
      !scope.record(function)
      && list.any(parts(subject, scope), fn(part) { refers(part.0, part.1) })
    glance.Fn(arguments:, body:, ..) ->
      refers_in(body, binding(scope, parameter_names(arguments), False))
    glance.Block(statements:, ..) -> refers_in(statements, scope)
    _ -> list.any(parts(subject, scope), fn(part) { refers(part.0, part.1) })
  }
}

fn refers_in(body: List(glance.Statement), scope: Scope) -> Bool {
  case body {
    [] -> False
    [glance.Assignment(pattern: assigned, value:, ..), ..rest] -> {
      let held = refers(value, scope)
      held || refers_in(rest, binding(scope, bound([assigned]), held))
    }
    [glance.Use(function:, patterns:, ..), ..rest] ->
      refers(function, scope)
      || refers_in(rest, binding(scope, use_names(patterns), False))
    [glance.Expression(inner), ..rest] ->
      refers(inner, scope) || refers_in(rest, scope)
    [glance.Assert(expression: asserted, ..), ..rest] ->
      refers(asserted, scope) || refers_in(rest, scope)
  }
}

fn use_names(patterns: List(glance.UsePattern)) -> List(String) {
  bound(list.map(patterns, fn(use_pattern) { use_pattern.pattern }))
}

/// The shell functions that `body` hands a callback naming app state. A
/// `use` hands on the rest of its block. A `let` that takes the name of a
/// parameter that holds app state still holds it, as far as this goes.
fn handed_in(body: List(glance.Statement), scope: Scope) -> List(String) {
  case body {
    [] -> []
    [glance.Assignment(value: inner, ..), ..rest]
    | [glance.Expression(inner), ..rest]
    | [glance.Assert(expression: inner, ..), ..rest] ->
      list.append(handed(inner, scope), handed_in(rest, scope))
    [glance.Use(function:, patterns:, ..), ..rest] -> {
      let inner = binding(scope, use_names(patterns), False)
      let made = case function {
        glance.Call(function: callee, ..) ->
          case scope.shell(callee), refers_in(rest, inner) {
            Some(called), True -> [called]
            _, _ -> []
          }
        _ -> []
      }
      list.flatten([made, handed(function, scope), handed_in(rest, inner)])
    }
  }
}

fn handed(subject: glance.Expression, scope: Scope) -> List(String) {
  let given = fn(callee, arguments) {
    let over =
      list.any(arguments, fn(argument) {
        case argument {
          glance.Fn(..) | glance.FnCapture(..) -> refers(argument, scope)
          _ -> False
        }
      })
    case scope.shell(callee), over {
      Some(called), True -> [called]
      _, _ -> []
    }
  }
  let made = case subject {
    glance.Call(function:, arguments:, ..) -> given(function, items(arguments))
    glance.FnCapture(function:, arguments_before:, arguments_after:, ..) ->
      given(
        function,
        list.append(items(arguments_before), items(arguments_after)),
      )
    glance.BinaryOperator(name: glance.Pipe, left:, right:, ..) ->
      case right {
        glance.Call(function: callee, ..)
        | glance.FnCapture(function: callee, ..) -> given(callee, [left])
        callee -> given(callee, [left])
      }
    _ -> []
  }
  let inside = case subject {
    glance.Fn(arguments:, body:, ..) ->
      handed_in(body, binding(scope, parameter_names(arguments), False))
    glance.Block(statements:, ..) -> handed_in(statements, scope)
    _ ->
      list.flat_map(parts(subject, scope), fn(part) { handed(part.0, part.1) })
  }
  list.append(made, inside)
}

fn skips_outcome(
  path: String,
  name: String,
  module: glance.Module,
) -> List(Finding) {
  use <- when(name == "editor")
  let aliases = aliases_of(module)
  let broken =
    list.filter_map(module.functions, fn(definition) {
      let function = definition.definition
      let takes =
        list.any(function.parameters, fn(parameter) {
          case parameter.type_ {
            Some(type_) -> mentions(expand(type_, aliases), ["Editor"])
            None -> False
          }
        })
      let hands_back = case option.map(function.return, expand(_, aliases)) {
        Some(returned) ->
          mentions(returned, ["Editor"]) && !mentions(returned, ["Outcome"])
        None -> False
      }
      case function.publicity, takes && hands_back {
        glance.Public, True ->
          Ok(Found(Broken(SkipsOutcome, path, function.name)))
        _, _ -> Error(Nil)
      }
    })
  [Looked(SkipsOutcome, path), ..broken]
}

fn forbidden_calls(
  path: String,
  name: String,
  module: glance.Module,
) -> List(Finding) {
  let resolve = resolver(module_key(path), module)
  let in_functions =
    list.map(module.functions, fn(definition) {
      let function = definition.definition
      #(function.name, statements(function.body), uses(function, resolve))
    })
  let in_constants =
    list.map(module.constants, fn(definition) {
      let seen = expression(definition.definition.value)
      #(definition.definition.name, seen, list.filter_map(seen, resolve))
    })
  let broken =
    list.flat_map(list.append(in_functions, in_constants), fn(one) {
      let #(holder, seen, used) = one
      let calls =
        list.filter_map(used, fn(called) {
          case called {
            "lustre/element.unsafe_raw_html" ->
              Ok(Found(Broken(RawHtml, path, holder)))
            "lustre/element/html.textarea" if name != "surface" ->
              Ok(Found(Broken(FieldWrite, path, holder <> " draws a textarea")))
            _ -> Error(Nil)
          }
        })
      let texts =
        list.filter_map(seen, fn(one) {
          case one {
            Text("textarea") | Text("contenteditable") if name != "surface" ->
              Ok(
                Found(Broken(FieldWrite, path, holder <> " names a text field")),
              )
            Text(_) | Name(_) | Remote(..) | Bound(_) -> Error(Nil)
          }
        })
      list.append(calls, texts)
    })
  [Looked(RawHtml, path), Looked(FieldWrite, path), ..broken]
}

type External {
  External(file: String, function: String)
}

fn external(
  definition: glance.Definition(glance.Function),
) -> Option(External) {
  list.find_map(definition.attributes, fn(attribute) {
    case attribute {
      glance.Attribute(
        "external",
        [_, glance.String(value: file, ..), glance.String(value: function, ..)],
      ) -> Ok(External(file:, function:))
      _ -> Error(Nil)
    }
  })
  |> option.from_result
}

fn module_key(path: String) -> String {
  string.replace(path, ".gleam", "")
}

/// Every function and constant that reaches page-changing JavaScript,
/// directly or through others, in any module.
fn changers(files: List(File)) -> Set(String) {
  reaching(files, fn(name, javascript) {
    touches_page(name) && !list.contains(measures, javascript)
  })
}

/// Every function and constant that reaches a JavaScript record, directly or
/// through others.
fn readers(files: List(File)) -> Set(String) {
  reaching(files, fn(_, javascript) { list.contains(records, javascript) })
}

/// Every function and constant that reaches a JavaScript function `picks`
/// chooses, given its module's name and its own, directly or through others.
fn reaching(
  files: List(File),
  picks: fn(String, String) -> Bool,
) -> Set(String) {
  let functions =
    list.flat_map(files, fn(file) {
      case file {
        Gleam(path:, name:, module:) -> {
          let key = module_key(path)
          let resolve = resolver(key, module)
          let functions =
            list.map(module.functions, fn(definition) {
              let function = definition.definition
              let starts = case external(definition) {
                Some(External(function: javascript, ..)) ->
                  picks(name, javascript)
                None -> False
              }
              #(key <> "." <> function.name, uses(function, resolve), starts)
            })
          let constants =
            list.map(module.constants, fn(definition) {
              let constant = definition.definition
              let used = list.filter_map(expression(constant.value), resolve)
              #(key <> "." <> constant.name, used, False)
            })
          list.append(functions, constants)
        }
        JavaScript(..) | Other(_) | Unreadable(_) -> []
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
  grow(start, functions)
}

fn grow(
  changers: Set(String),
  functions: List(#(String, List(String), Bool)),
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

/// The functions `function` names, as "nullpad/surface.blur_control". A
/// name the function binds itself (a parameter, a `let`) is not one.
fn uses(
  function: glance.Function,
  resolve: fn(Seen) -> Result(String, Nil),
) -> List(String) {
  let seen = statements(function.body)
  let bound =
    list.filter_map(function.parameters, fn(parameter) {
      case parameter.name {
        glance.Named(name) -> Ok(name)
        glance.Discarded(_) -> Error(Nil)
      }
    })
    |> list.append(
      list.filter_map(seen, fn(one) {
        case one {
          Bound(name) -> Ok(name)
          Name(_) | Remote(..) | Text(_) -> Error(Nil)
        }
      }),
    )
  list.filter(seen, fn(one) {
    case one {
      Name(name) -> !list.contains(bound, name)
      Remote(..) | Text(_) | Bound(_) -> True
    }
  })
  |> list.filter_map(resolve)
  |> list.unique
}

fn resolver(
  key: String,
  module: glance.Module,
) -> fn(Seen) -> Result(String, Nil) {
  let locals =
    list.map(module.functions, fn(definition) { definition.definition.name })
    |> list.append(
      list.map(module.constants, fn(definition) { definition.definition.name }),
    )
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
      Text(_) | Bound(_) -> Error(Nil)
    }
  }
}

type Seen {
  Name(String)
  Remote(alias: String, label: String)
  /// A string literal.
  Text(String)
  /// A name the code binds: a `let`, a pattern variable, a closure parameter.
  Bound(String)
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

fn fields(
  given: List(glance.Field(glance.Expression)),
  each: fn(glance.Expression) -> List(Seen),
) -> List(Seen) {
  list.flat_map(given, fn(field) {
    case field {
      glance.LabelledField(item:, ..) -> each(item)
      glance.ShorthandField(label:, ..) -> [Name(label)]
      glance.UnlabelledField(item) -> each(item)
    }
  })
}

/// A string literal, or literals joined with `<>`.
fn literal(subject: glance.Expression) -> Option(String) {
  case subject {
    glance.String(value:, ..) -> Some(value)
    glance.BinaryOperator(name: glance.Concatenate, left:, right:, ..) ->
      case literal(left), literal(right) {
        Some(left), Some(right) -> Some(left <> right)
        _, _ -> None
      }
    _ -> None
  }
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
    glance.Fn(arguments:, body:, ..) ->
      list.append(
        list.filter_map(arguments, fn(argument) {
          case argument.name {
            glance.Named(name) -> Ok(Bound(name))
            glance.Discarded(_) -> Error(Nil)
          }
        }),
        statements(body),
      )
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
      list.append(expression(function), fields(arguments, expression))
    glance.TupleIndex(tuple:, ..) -> expression(tuple)
    glance.FnCapture(function:, arguments_before:, arguments_after:, ..) ->
      list.flatten([
        expression(function),
        fields(arguments_before, expression),
        fields(arguments_after, expression),
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
    glance.BinaryOperator(name: glance.Concatenate, left:, right:, ..) ->
      case literal(subject) {
        Some(text) -> [Text(text)]
        None -> list.append(expression(left), expression(right))
      }
    glance.BinaryOperator(left:, right:, ..) ->
      list.append(expression(left), expression(right))
    glance.Echo(expression: echoed, message:, ..) ->
      list.append(maybe(echoed), maybe(message))
  }
}

fn pattern(subject: glance.Pattern) -> List(Seen) {
  let named = fn(name: glance.AssignmentName) {
    case name {
      glance.Named(name) -> [Bound(name)]
      glance.Discarded(_) -> []
    }
  }
  case subject {
    glance.PatternConcatenate(prefix_name:, rest_name:, ..) ->
      list.append(
        named(rest_name),
        option.map(prefix_name, named) |> option.unwrap([]),
      )
    glance.PatternVariable(name:, ..) -> [Bound(name)]
    glance.PatternTuple(elements:, ..) -> list.flat_map(elements, pattern)
    glance.PatternList(elements:, tail:, ..) ->
      list.append(list.flat_map(elements, pattern), case tail {
        Some(tail) -> pattern(tail)
        None -> []
      })
    glance.PatternAssignment(pattern: inner, name:, ..) -> [
      Bound(name),
      ..pattern(inner)
    ]
    glance.PatternVariant(arguments:, ..) ->
      list.flat_map(arguments, fn(field) {
        case field {
          glance.LabelledField(item:, ..) -> pattern(item)
          glance.UnlabelledField(item) -> pattern(item)
          glance.ShorthandField(label:, ..) -> [Bound(label)]
        }
      })
    glance.PatternString(..)
    | glance.PatternInt(..)
    | glance.PatternFloat(..)
    | glance.PatternDiscard(..)
    | glance.PatternBitString(..) -> []
  }
}

fn javascript(path: String, name: String) -> List(Finding) {
  [
    Looked(JavaScriptFile, path),
    ..when(!has_javascript(name), fn() {
      [Found(Broken(JavaScriptFile, path, "this module may not have one"))]
    })
  ]
}

fn faults(files: List(File), looked: List(#(Rule, String))) -> List(String) {
  let names =
    list.filter_map(files, fn(file) {
      case file {
        Gleam(name:, ..) | JavaScript(name:, ..) -> Ok(name)
        Other(_) | Unreadable(_) -> Error(Nil)
      }
    })
  let unreadable =
    list.filter_map(files, fn(file) {
      case file {
        Unreadable(path) -> Ok("glance could not parse " <> path)
        Gleam(..) | JavaScript(..) | Other(_) -> Error(Nil)
      }
    })
  let missing =
    list.flatten([core, shell, with_javascript])
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
            external(definition)
            |> option.map(fn(external) { external.function })
            |> option.to_result(Nil)
          })
        JavaScript(..) | Other(_) | Unreadable(_) -> []
      }
    })
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
    unused(records, externals, "record"),
  ])
}
