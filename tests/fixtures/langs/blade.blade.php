@extends('layouts.app')
@section('content')
  @include('partials.nav')
  <x-alert type="error" />
  {{ helper($name) }}
@endsection
